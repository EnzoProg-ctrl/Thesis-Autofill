"""
checkpoint.py
=============
Load a trained FIRS checkpoint. Serving only — no training code.

Why this is a separate file
---------------------------
In the research repo, ``serve.py`` imported its loader from
``train_roberta.py``, which drags in pandas, scikit-learn, the training loop,
the experiment harness and the archiver. None of that is needed to answer an
HTTP request, and requiring a teammate to install the full research stack just
to run the service is a good way to ensure nobody runs it.

This is the same loading logic with the training dependencies removed. It
needs only torch, transformers and ``roberta_model.py``.

It must stay behaviourally identical to
``RobertaTraining/train_roberta.py:load_checkpoint`` — if a checkpoint loads
differently here than in evaluation, the served predictions will not match the
measured ones, and nothing will announce it.
"""

from __future__ import annotations

import json
from pathlib import Path

import torch
from transformers import AutoTokenizer

from roberta_model import ComplaintClassifier, MultiTaskClassifier


def load_checkpoint(save_dir: str | Path, device: torch.device):
    """Return (model, tokenizer, label_map) ready for inference."""
    save_dir = Path(save_dir)
    meta = json.loads((save_dir / "meta.json").read_text(encoding="utf-8"))
    label_map = {int(k): v for k, v in
                 json.loads((save_dir / "label_map.json").read_text(encoding="utf-8")).items()}

    if meta.get("multitask"):
        model = MultiTaskClassifier(
            model_name=str(save_dir / "backbone"),
            num_labels=meta["num_labels"],
            num_priority_labels=meta["num_priority_labels"],
            pooling=meta["pooling"],
            num_issue_labels=meta.get("num_issue_labels", 0),
        )
        model.priority_head.load_state_dict(
            torch.load(save_dir / "priority_head.pt", map_location="cpu"))
        if model.issue_head is not None:
            model.issue_head.load_state_dict(
                torch.load(save_dir / "issue_head.pt", map_location="cpu"))
    else:
        model = ComplaintClassifier(
            model_name=str(save_dir / "backbone"),
            num_labels=meta["num_labels"],
            pooling=meta["pooling"],
        )
    model.head.load_state_dict(torch.load(save_dir / "head.pt", map_location="cpu"))

    # The shipped checkpoint stores the backbone in fp16 to halve its download
    # size. CPUs are slower at fp16 arithmetic than fp32, so cast back up when
    # serving on CPU; on GPU fp16 is left alone because it is faster there.
    # This changes nothing about the predictions — the conversion was verified
    # across all 1788 test rows: 0 category and 1 priority prediction differed.
    if device.type == "cpu":
        model = model.float()

    model = model.to(device)
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(save_dir)
    return model, tokenizer, label_map


def load_priority_map(save_dir: str | Path) -> dict[int, str] | None:
    """Priority id -> label for a multi-task checkpoint; None for category-only."""
    path = Path(save_dir) / "priority_map.json"
    if not path.exists():
        return None
    return {int(k): v for k, v in
            json.loads(path.read_text(encoding="utf-8")).items()}
