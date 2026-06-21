/* ============================================================
   Mock Data — 50 Tenants, Sample Issues, Staff, Analytics
   ============================================================ */

export const CATEGORIES = [
  { id: 'electrical', label: 'Electrical', icon: '⚡' },
  { id: 'plumbing', label: 'Plumbing', icon: '🔧' },
  { id: 'hvac', label: 'HVAC / Air Conditioning', icon: '❄️' },
  { id: 'structural', label: 'Structural', icon: '🏗️' },
  { id: 'pest', label: 'Pest Control', icon: '🐛' },
  { id: 'elevator', label: 'Elevator / Escalator', icon: '🛗' },
  { id: 'fire_safety', label: 'Fire Safety', icon: '🔥' },
  { id: 'housekeeping', label: 'Housekeeping', icon: '🧹' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 'it_network', label: 'IT / Network', icon: '📡' },
  { id: 'other', label: 'Other', icon: '📋' },
];

export const PRIORITY_LEVELS = [
  { id: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
  { id: 'high', label: 'High', color: '#ea580c', bg: '#fff7ed' },
  { id: 'medium', label: 'Medium', color: '#d97706', bg: '#fffbeb' },
  { id: 'low', label: 'Low', color: '#3b82f6', bg: '#eff6ff' },
];

export const STATUS_LIST = [
  { id: 'awaiting_review', label: 'Awaiting Review', color: '#f59e0b' },
  { id: 'in_progress', label: 'In Progress', color: '#0ea5e9' },
  { id: 'resolved', label: 'Resolved', color: '#22c55e' },
];

export const TENANTS = [
  { id: 'T001', name: 'Jollibee', floor: 'GF', zone: 'A', contact: 'Maria Santos', phone: '0917-111-0001', type: 'Restaurant' },
  { id: 'T002', name: 'Mercury Drug', floor: 'GF', zone: 'A', contact: 'Jose Reyes', phone: '0918-222-0002', type: 'Pharmacy' },
  { id: 'T003', name: 'Bench', floor: 'GF', zone: 'B', contact: 'Ana Cruz', phone: '0919-333-0003', type: 'Fashion' },
  { id: 'T004', name: 'Penshoppe', floor: 'GF', zone: 'B', contact: 'Carlo Mendoza', phone: '0920-444-0004', type: 'Fashion' },
  { id: 'T005', name: 'Potato Corner', floor: 'GF', zone: 'C', contact: 'Liza Bautista', phone: '0921-555-0005', type: 'Food Stall' },
  { id: 'T006', name: 'Goldilocks', floor: 'GF', zone: 'C', contact: 'Pedro Garcia', phone: '0922-666-0006', type: 'Bakery' },
  { id: 'T007', name: 'Watsons', floor: 'GF', zone: 'D', contact: 'Rosa Villanueva', phone: '0923-777-0007', type: 'Health & Beauty' },
  { id: 'T008', name: 'National Book Store', floor: 'GF', zone: 'D', contact: 'Mark Aquino', phone: '0924-888-0008', type: 'Bookstore' },
  { id: 'T009', name: 'BDO Branch', floor: 'GF', zone: 'A', contact: 'Luis Dela Cruz', phone: '0925-999-0009', type: 'Bank' },
  { id: 'T010', name: 'Globe Store', floor: 'GF', zone: 'B', contact: 'Jenny Ramos', phone: '0926-111-0010', type: 'Telecom' },
  { id: 'T011', name: 'Mang Inasal', floor: '2F', zone: 'A', contact: 'Ricardo Flores', phone: '0917-222-0011', type: 'Restaurant' },
  { id: 'T012', name: 'Greenwich', floor: '2F', zone: 'A', contact: 'Elena Torres', phone: '0918-333-0012', type: 'Restaurant' },
  { id: 'T013', name: 'SM Appliances', floor: '2F', zone: 'B', contact: 'Danny Lim', phone: '0919-444-0013', type: 'Appliances' },
  { id: 'T014', name: 'Miniso', floor: '2F', zone: 'B', contact: 'Grace Tan', phone: '0920-555-0014', type: 'Variety Store' },
  { id: 'T015', name: "Levi's", floor: '2F', zone: 'C', contact: 'Kevin Soriano', phone: '0921-666-0015', type: 'Fashion' },
  { id: 'T016', name: 'Giordano', floor: '2F', zone: 'C', contact: 'Beth Navarro', phone: '0922-777-0016', type: 'Fashion' },
  { id: 'T017', name: 'David\'s Salon', floor: '2F', zone: 'D', contact: 'Sharon Dizon', phone: '0923-888-0017', type: 'Salon' },
  { id: 'T018', name: 'Optical Media', floor: '2F', zone: 'D', contact: 'Andrew Pascual', phone: '0924-999-0018', type: 'Electronics' },
  { id: 'T019', name: 'Chowking', floor: '2F', zone: 'A', contact: 'Mylene Castillo', phone: '0925-111-0019', type: 'Restaurant' },
  { id: 'T020', name: 'Ace Hardware', floor: '2F', zone: 'B', contact: 'Raul Morales', phone: '0926-222-0020', type: 'Hardware' },
  { id: 'T021', name: 'Samsung Store', floor: '3F', zone: 'A', contact: 'Ian Villanueva', phone: '0917-333-0021', type: 'Electronics' },
  { id: 'T022', name: 'Huawei Experience Store', floor: '3F', zone: 'A', contact: 'Carla Fernandez', phone: '0918-444-0022', type: 'Electronics' },
  { id: 'T023', name: 'CD-R King', floor: '3F', zone: 'B', contact: 'Ronnie Mercado', phone: '0919-555-0023', type: 'Electronics' },
  { id: 'T024', name: 'Power Mac Center', floor: '3F', zone: 'B', contact: 'Diana Cruz', phone: '0920-666-0024', type: 'Electronics' },
  { id: 'T025', name: 'Timezone', floor: '3F', zone: 'C', contact: 'Bryan Abad', phone: '0921-777-0025', type: 'Entertainment' },
  { id: 'T026', name: 'Tom\'s World', floor: '3F', zone: 'C', contact: 'Mae Santos', phone: '0922-888-0026', type: 'Entertainment' },
  { id: 'T027', name: 'Surplus Shop', floor: '3F', zone: 'D', contact: 'Noel Aguilar', phone: '0923-999-0027', type: 'Retail' },
  { id: 'T028', name: 'Handyman', floor: '3F', zone: 'D', contact: 'Tess Lacson', phone: '0924-111-0028', type: 'Hardware' },
  { id: 'T029', name: 'KFC', floor: '3F', zone: 'A', contact: 'Oliver Salazar', phone: '0925-222-0029', type: 'Restaurant' },
  { id: 'T030', name: 'Tokyo Tokyo', floor: '3F', zone: 'B', contact: 'Vivian Corpuz', phone: '0926-333-0030', type: 'Restaurant' },
  { id: 'T031', name: 'Max\'s Restaurant', floor: '4F', zone: 'A', contact: 'George Pineda', phone: '0917-444-0031', type: 'Restaurant' },
  { id: 'T032', name: 'Shakey\'s', floor: '4F', zone: 'A', contact: 'Nina Flores', phone: '0918-555-0032', type: 'Restaurant' },
  { id: 'T033', name: 'BonChon', floor: '4F', zone: 'B', contact: 'Alvin Rivera', phone: '0919-666-0033', type: 'Restaurant' },
  { id: 'T034', name: 'Pepper Lunch', floor: '4F', zone: 'B', contact: 'Jasmine Ocampo', phone: '0920-777-0034', type: 'Restaurant' },
  { id: 'T035', name: 'Cinnabon', floor: '4F', zone: 'C', contact: 'Victor Bello', phone: '0921-888-0035', type: 'Cafe' },
  { id: 'T036', name: 'Starbucks', floor: '4F', zone: 'C', contact: 'Christine Yu', phone: '0922-999-0036', type: 'Cafe' },
  { id: 'T037', name: 'The SM Store', floor: 'GF', zone: 'A', contact: 'Joel Manalo', phone: '0923-111-0037', type: 'Department Store' },
  { id: 'T038', name: 'Toby\'s Sports', floor: '2F', zone: 'C', contact: 'Patrick David', phone: '0924-222-0038', type: 'Sports' },
  { id: 'T039', name: 'Anson\'s', floor: '2F', zone: 'D', contact: 'Rebecca Tan', phone: '0925-333-0039', type: 'Appliances' },
  { id: 'T040', name: 'Fully Booked', floor: '3F', zone: 'C', contact: 'Martin Lim', phone: '0926-444-0040', type: 'Bookstore' },
  { id: 'T041', name: 'Swatch', floor: 'GF', zone: 'C', contact: 'Lea Gutierrez', phone: '0917-555-0041', type: 'Accessories' },
  { id: 'T042', name: 'Pandora', floor: 'GF', zone: 'D', contact: 'Irene dela Rosa', phone: '0918-666-0042', type: 'Jewelry' },
  { id: 'T043', name: 'H&M', floor: '2F', zone: 'A', contact: 'Ryan Sy', phone: '0919-777-0043', type: 'Fashion' },
  { id: 'T044', name: 'Uniqlo', floor: '2F', zone: 'B', contact: 'Joyce Magalona', phone: '0920-888-0044', type: 'Fashion' },
  { id: 'T045', name: 'Krispy Kreme', floor: '4F', zone: 'D', contact: 'Francis Ong', phone: '0921-999-0045', type: 'Cafe' },
  { id: 'T046', name: 'J.CO Donuts', floor: '4F', zone: 'D', contact: 'Mariel Barreto', phone: '0922-111-0046', type: 'Cafe' },
  { id: 'T047', name: 'Bo\'s Coffee', floor: '4F', zone: 'C', contact: 'Nelson Aragon', phone: '0923-222-0047', type: 'Cafe' },
  { id: 'T048', name: 'Dental Care Clinic', floor: '3F', zone: 'D', contact: 'Dr. Cathy Reyes', phone: '0924-333-0048', type: 'Clinic' },
  { id: 'T049', name: 'ML Kwarta Padala', floor: 'GF', zone: 'D', contact: 'Randy Dela Cruz', phone: '0925-444-0049', type: 'Remittance' },
  { id: 'T050', name: 'LBC Express', floor: 'GF', zone: 'C', contact: 'Susan Alvarez', phone: '0926-555-0050', type: 'Courier' },
];

export const STAFF = [
  { id: 'S01', name: 'Engr. Roberto Manansala', role: 'Chief Engineer', avatar: '👷' },
  { id: 'S02', name: 'Mario Dela Vega', role: 'Electrician', avatar: '🔌' },
  { id: 'S03', name: 'Jun Alvarez', role: 'Plumber', avatar: '🔧' },
  { id: 'S04', name: 'Dennis Soriano', role: 'HVAC Technician', avatar: '❄️' },
  { id: 'S05', name: 'Arnold Bautista', role: 'General Maintenance', avatar: '🛠️' },
  { id: 'S06', name: 'Rex Cayetano', role: 'IT Support', avatar: '💻' },
  { id: 'S07', name: 'Joel Pangilinan', role: 'Pest Control', avatar: '🐛' },
  { id: 'S08', name: 'Nestor Roque', role: 'Security Officer', avatar: '🔒' },
];

/* ---------- Sample Issues (pre-populated for demo) ---------- */

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(Math.floor(Math.random() * 12) + 7, Math.floor(Math.random() * 60));
  return d.toISOString();
}

export const SAMPLE_ISSUES = [];

/* ---------- Historical Data for Analytics (6 months) ---------- */

const MONTHS_LABELS = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'];

export const HISTORICAL_DATA = {
  months: MONTHS_LABELS,

  /* Issues submitted per month */
  issuesByMonth: [0, 0, 0, 0, 0, 0],

  /* Issues by category per month */
  categoryTrends: {
    electrical: [0, 0, 0, 0, 0, 0],
    plumbing: [0, 0, 0, 0, 0, 0],
    hvac: [0, 0, 0, 0, 0, 0],
    structural: [0, 0, 0, 0, 0, 0],
    pest: [0, 0, 0, 0, 0, 0],
    elevator: [0, 0, 0, 0, 0, 0],
    fire_safety: [0, 0, 0, 0, 0, 0],
    housekeeping: [0, 0, 0, 0, 0, 0],
    security: [0, 0, 0, 0, 0, 0],
    it_network: [0, 0, 0, 0, 0, 0],
  },

  /* Priority distribution per month */
  priorityTrends: {
    critical: [0, 0, 0, 0, 0, 0],
    high: [0, 0, 0, 0, 0, 0],
    medium: [0, 0, 0, 0, 0, 0],
    low: [0, 0, 0, 0, 0, 0],
  },

  /* Avg resolution time in hours by category */
  avgResolutionTime: {
    electrical: 0, plumbing: 0, hvac: 0, structural: 0,
    pest: 0, elevator: 0, fire_safety: 0, housekeeping: 0,
    security: 0, it_network: 0,
  },

  /* AI accuracy per month (%) */
  aiAccuracy: [0, 0, 0, 0, 0, 0],

  /* Budget estimates per category (PHP) */
  budgetByCategory: {
    electrical: 0, plumbing: 0, hvac: 0, structural: 0,
    pest: 0, elevator: 0, fire_safety: 0, housekeeping: 0,
    security: 0, it_network: 0,
  },
};

/* ---------- Helper: get tenant by ID ---------- */
export function getTenantById(id) {
  return TENANTS.find(t => t.id === id) || null;
}

/* ---------- Helper: get category label ---------- */
export function getCategoryLabel(catId) {
  const c = CATEGORIES.find(c => c.id === catId);
  return c ? c.label : catId;
}

export function getCategoryIcon(catId) {
  const c = CATEGORIES.find(c => c.id === catId);
  return c ? c.icon : '📋';
}

export function getStaffById(id) {
  return STAFF.find(s => s.id === id) || null;
}

export function getStatusInfo(statusId) {
  return STATUS_LIST.find(s => s.id === statusId) || STATUS_LIST[0];
}

export function getPriorityInfo(levelId) {
  return PRIORITY_LEVELS.find(p => p.id === levelId) || PRIORITY_LEVELS[3];
}
