"""
roberta_model.py
=================
Reusable building blocks for the RoBERTa complaint-classification experiment
harness: a configurable classifier head (CLS vs mean pooling), layer-wise
learning-rate decay (LLRD) parameter grouping, alternative loss functions
(focal loss, label smoothing), and scheduler construction.
"""

from __future__ import annotations

import math
from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import (
    AutoConfig,
    AutoModel,
    get_cosine_with_hard_restarts_schedule_with_warmup,
    get_linear_schedule_with_warmup,
)


# ──────────────────────────────────────────────
#  Classifier
# ──────────────────────────────────────────────

class ClassificationHead(nn.Module):
    """Replicates HF's RobertaClassificationHead: dense -> tanh -> dropout -> out_proj."""

    def __init__(self, hidden_size: int, num_labels: int, dropout: float = 0.1) -> None:
        super().__init__()
        self.dense = nn.Linear(hidden_size, hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.out_proj = nn.Linear(hidden_size, num_labels)

    def forward(self, pooled: torch.Tensor) -> torch.Tensor:
        x = self.dropout(pooled)
        x = self.dense(x)
        x = torch.tanh(x)
        x = self.dropout(x)
        return self.out_proj(x)


class ComplaintClassifier(nn.Module):
    """RoBERTa backbone + configurable pooling + classification head.

    Parameters
    ----------
    model_name : str
        HF hub id, e.g. "xlm-roberta-base" (multilingual, the default -- the
        complaints are Taglish and English-only RoBERTa has no Tagalog in its
        vocabulary), "roberta-base", or "roberta-large". XLM-R shares RoBERTa's
        module layout, so pooling and LLRD grouping work unchanged.
    num_labels : int
        Number of output classes.
    pooling : str
        "cls" (use the `<s>` token hidden state, equivalent to the default
        HF `AutoModelForSequenceClassification` behaviour) or "mean"
        (attention-mask-weighted mean over all token hidden states).
    """

    def __init__(self, model_name: str, num_labels: int, pooling: str = "cls") -> None:
        super().__init__()
        if pooling not in ("cls", "mean"):
            raise ValueError(f"Unknown pooling strategy: {pooling!r}")
        self.pooling = pooling
        self.config = AutoConfig.from_pretrained(model_name)
        self.backbone = AutoModel.from_pretrained(model_name)
        dropout = getattr(self.config, "hidden_dropout_prob", 0.1) or 0.1
        self.head = ClassificationHead(self.config.hidden_size, num_labels, dropout)

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> Any:
        outputs = self.backbone(input_ids=input_ids, attention_mask=attention_mask)
        hidden = outputs.last_hidden_state  # (B, T, H)

        if self.pooling == "cls":
            pooled = hidden[:, 0, :]
        else:  # mean
            mask = attention_mask.unsqueeze(-1).to(hidden.dtype)  # (B, T, 1)
            summed = (hidden * mask).sum(dim=1)
            counts = mask.sum(dim=1).clamp(min=1e-9)
            pooled = summed / counts

        logits = self.head(pooled)
        return _Output(logits=logits)


class _Output:
    """Minimal stand-in for HF's ModelOutput so call sites can do `outputs.logits`."""

    def __init__(self, logits: torch.Tensor,
                 priority_logits: torch.Tensor | None = None,
                 issue_logits: torch.Tensor | None = None) -> None:
        self.logits = logits
        self.priority_logits = priority_logits
        self.issue_logits = issue_logits


class MultiTaskClassifier(nn.Module):
    """One backbone, two heads: category and priority.

    Why two heads rather than two models
    ------------------------------------
    Priority is not a relabelling of category — within Electrical alone the
    dataset carries 6 Critical, 6 High, 6 Low and 4 Medium issue types, so the
    model must read the description either way. Sharing the encoder means one
    forward pass serves both predictions (halving inference cost against two
    separate models, which matters on CPU) and lets the category signal inform
    priority: "Electrical" plus "burning smell" is a stronger Critical cue than
    either alone.

    Known limitation, worth stating plainly: in the current corpus priority is
    a constant per issue type. The model therefore learns issue-type -> priority
    rather than severity judged from context. It cannot tell a small leak from a
    catastrophic one when both are phrased as the same issue. That is a property
    of the data, not the architecture, and it will only change when real reports
    with independently assigned priorities exist.
    """

    def __init__(self, model_name: str, num_labels: int, num_priority_labels: int,
                 pooling: str = "cls", num_issue_labels: int = 0) -> None:
        super().__init__()
        if pooling not in ("cls", "mean"):
            raise ValueError(f"Unknown pooling strategy: {pooling!r}")
        self.pooling = pooling
        self.config = AutoConfig.from_pretrained(model_name)
        self.backbone = AutoModel.from_pretrained(model_name)
        dropout = getattr(self.config, "hidden_dropout_prob", 0.1) or 0.1
        self.head = ClassificationHead(self.config.hidden_size, num_labels, dropout)
        self.priority_head = ClassificationHead(self.config.hidden_size, num_priority_labels, dropout)

        # Auxiliary issue-type head, used during TRAINING ONLY and never served.
        #
        # Rationale from the data: priority is constant per issue type, so
        # getting priority right means resolving which of ~21 issues within a
        # category this is — far finer than the 8-way category task. The shared
        # pooled vector is optimised for 8-way separation, so exactly the
        # detail priority needs tends to get compressed away. Asking the
        # encoder to also name the issue keeps that detail present.
        self.issue_head = (
            ClassificationHead(self.config.hidden_size, num_issue_labels, dropout)
            if num_issue_labels else None
        )

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> Any:
        hidden = self.backbone(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state

        if self.pooling == "cls":
            pooled = hidden[:, 0, :]
        else:
            mask = attention_mask.unsqueeze(-1).to(hidden.dtype)
            pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)

        return _Output(
            logits=self.head(pooled),
            priority_logits=self.priority_head(pooled),
            issue_logits=self.issue_head(pooled) if self.issue_head is not None else None,
        )


def freeze_embeddings(model: ComplaintClassifier) -> int:
    """Freeze the backbone's embedding table. Returns the frozen param count.

    Matters most for the multilingual backbones: xlm-roberta-base carries a
    250k-token vocabulary, so its embeddings are ~192M of its ~278M parameters
    (roberta-base, with a 50k vocabulary, is only ~39M of ~125M). AdamW keeps
    two extra state tensors per *trainable* parameter, so freezing the table
    cuts optimizer memory by roughly two thirds and drops a large matrix from
    every backward pass -- the difference between comfortable and painful on a
    CPU-only box.

    The pretrained embeddings already cover the vocabulary; on classification
    fine-tuning the encoder layers do the task-specific work, so this is
    usually free in accuracy terms. Verify on your own data before assuming it.
    """
    frozen = 0
    for param in model.backbone.embeddings.parameters():
        param.requires_grad = False
        frozen += param.numel()
    return frozen


# ──────────────────────────────────────────────
#  Layer-wise Learning Rate Decay
# ──────────────────────────────────────────────

def build_llrd_param_groups(
    model: ComplaintClassifier,
    base_lr: float,
    weight_decay: float,
    decay: float = 0.9,
) -> list[dict[str, Any]]:
    """Build AdamW param groups with layer-wise LR decay.

    Embeddings get the lowest LR; each encoder layer going up gets a higher
    LR (`base_lr * decay**(n_layers - layer_idx)`); the classification head
    gets `base_lr` (undecayed, the highest rate). Generic over backbone depth
    so it works for both roberta-base (12 layers) and roberta-large (24).
    """
    no_decay = ("bias", "LayerNorm.weight")
    encoder_layers = model.backbone.encoder.layer
    n_layers = len(encoder_layers)

    groups: list[dict[str, Any]] = []

    def add_group(named_params, lr: float) -> None:
        # Frozen params must not reach AdamW: it would allocate optimizer state
        # for tensors that never receive a gradient.
        named_params = [(n, p) for n, p in named_params if p.requires_grad]
        decay_params = [p for n, p in named_params if not any(nd in n for nd in no_decay)]
        no_decay_params = [p for n, p in named_params if any(nd in n for nd in no_decay)]
        if decay_params:
            groups.append({"params": decay_params, "lr": lr, "weight_decay": weight_decay})
        if no_decay_params:
            groups.append({"params": no_decay_params, "lr": lr, "weight_decay": 0.0})

    # Embeddings: lowest LR (as if one layer below layer 0)
    embed_lr = base_lr * (decay ** (n_layers + 1))
    add_group(list(model.backbone.embeddings.named_parameters()), embed_lr)

    # Encoder layers: increasing LR toward the top
    for layer_idx, layer in enumerate(encoder_layers):
        layer_lr = base_lr * (decay ** (n_layers - layer_idx))
        add_group(list(layer.named_parameters()), layer_lr)

    # Any remaining backbone params not covered above (e.g. pooler) at base_lr
    covered_ids = {id(p) for g in groups for p in g["params"]}
    leftover_backbone = [
        (n, p) for n, p in model.backbone.named_parameters() if id(p) not in covered_ids
    ]
    if leftover_backbone:
        add_group(leftover_backbone, base_lr)

    # Classification head(s): highest LR (undecayed). Enumerated explicitly
    # rather than assuming a single `head` — a multi-task model carries a
    # second head, and omitting it here would exclude it from the optimizer
    # entirely, leaving it at its random initialisation with no error raised.
    for attr in ("head", "priority_head", "issue_head"):
        head = getattr(model, attr, None)
        if head is not None:
            add_group(list(head.named_parameters()), base_lr)

    return groups


def build_flat_param_groups(
    model: ComplaintClassifier, base_lr: float, weight_decay: float,
) -> list[dict[str, Any]]:
    """Standard single-LR param groups (decay vs no-decay), used when LLRD is off."""
    no_decay = ("bias", "LayerNorm.weight")
    trainable = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
    decay_params = [p for n, p in trainable if not any(nd in n for nd in no_decay)]
    no_decay_params = [p for n, p in trainable if any(nd in n for nd in no_decay)]
    groups = []
    if decay_params:
        groups.append({"params": decay_params, "lr": base_lr, "weight_decay": weight_decay})
    if no_decay_params:
        groups.append({"params": no_decay_params, "lr": base_lr, "weight_decay": 0.0})
    return groups


# ──────────────────────────────────────────────
#  Loss functions
# ──────────────────────────────────────────────

class FocalLoss(nn.Module):
    """Multi-class focal loss: (1 - p_t)^gamma * CE(p_t), with optional class weights."""

    def __init__(self, gamma: float = 2.0, weight: torch.Tensor | None = None) -> None:
        super().__init__()
        self.gamma = gamma
        self.weight = weight

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        ce = F.cross_entropy(logits, targets, weight=self.weight, reduction="none")
        p_t = torch.exp(-ce)
        focal = ((1 - p_t) ** self.gamma) * ce
        return focal.mean()


class OrdinalLoss(nn.Module):
    """Cross-entropy plus an asymmetric distance penalty, for ordered labels.

    Priority is ordered — Low < Medium < High < Critical — but cross-entropy
    treats the four as unrelated: calling a Critical report "Low" costs exactly
    what calling it "High" costs. For a triage system those are not remotely
    the same mistake.

    This adds a penalty proportional to how many levels the predicted
    distribution sits away from the truth, weighted more heavily when the
    prediction falls BELOW the true level. Over-escalation wastes a
    technician's afternoon; under-escalation sends a blocked fire exit to the
    back of the queue.

    Parameters
    ----------
    alpha : strength of the distance penalty relative to cross-entropy.
    under_weight : multiplier applied to the penalty when the model predicts a
        level lower than the truth. 1.0 makes the loss symmetric.
    """

    def __init__(self, num_classes: int, alpha: float = 0.5,
                 under_weight: float = 2.0, weight: torch.Tensor | None = None) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.alpha = alpha
        self.under_weight = under_weight
        self.weight = weight

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        ce = F.cross_entropy(logits, targets, weight=self.weight)

        probs = F.softmax(logits, dim=1)
        levels = torch.arange(self.num_classes, device=logits.device, dtype=probs.dtype)
        # signed[b, i] < 0 means class i sits below the true level for item b
        signed = levels.unsqueeze(0) - targets.unsqueeze(1).to(probs.dtype)
        penalty = torch.where(signed < 0, self.under_weight, 1.0) * signed.abs()
        expected_cost = (probs * penalty).sum(dim=1).mean()

        return ce + self.alpha * expected_cost


def build_loss_fn(
    loss_type: str,
    class_weights: torch.Tensor,
    label_smoothing: float = 0.0,
    focal_gamma: float = 2.0,
    num_classes: int | None = None,
    ordinal_alpha: float = 0.5,
    ordinal_under_weight: float = 2.0,
) -> nn.Module:
    """Return the configured loss module.

    Parameters
    ----------
    loss_type : str
        "ce" (cross-entropy, with optional label smoothing) or "focal".
    """
    if loss_type == "ce":
        return nn.CrossEntropyLoss(weight=class_weights, label_smoothing=label_smoothing)
    if loss_type == "focal":
        return FocalLoss(gamma=focal_gamma, weight=class_weights)
    if loss_type == "ordinal":
        if num_classes is None:
            raise ValueError("loss_type='ordinal' requires num_classes")
        return OrdinalLoss(num_classes, alpha=ordinal_alpha,
                           under_weight=ordinal_under_weight, weight=class_weights)
    raise ValueError(f"Unknown loss_type: {loss_type!r}")


# ──────────────────────────────────────────────
#  Scheduler
# ──────────────────────────────────────────────

def build_scheduler(
    scheduler_type: str,
    optimizer: torch.optim.Optimizer,
    warmup_steps: int,
    total_steps: int,
    cycles: int = 2,
) -> Any:
    """Return the configured LR scheduler.

    Parameters
    ----------
    scheduler_type : str
        "linear" or "cosine_restarts".
    """
    if scheduler_type == "linear":
        return get_linear_schedule_with_warmup(
            optimizer, num_warmup_steps=warmup_steps, num_training_steps=total_steps,
        )
    if scheduler_type == "cosine_restarts":
        return get_cosine_with_hard_restarts_schedule_with_warmup(
            optimizer,
            num_warmup_steps=warmup_steps,
            num_training_steps=total_steps,
            num_cycles=cycles,
        )
    raise ValueError(f"Unknown scheduler_type: {scheduler_type!r}")
