/* ============================================================
   Mock Data — 50 Tenants, Sample Issues, Staff, Analytics
   ============================================================ */

export const CATEGORIES = [
  { id: 'electrical',  label: 'Electrical',           icon: '⚡' },
  { id: 'plumbing',    label: 'Plumbing',             icon: '🔧' },
  { id: 'hvac',        label: 'HVAC / Air Conditioning', icon: '❄️' },
  { id: 'structural',  label: 'Structural',           icon: '🏗️' },
  { id: 'pest',        label: 'Pest Control',         icon: '🐛' },
  { id: 'elevator',    label: 'Elevator / Escalator', icon: '🛗' },
  { id: 'fire_safety', label: 'Fire Safety',          icon: '🔥' },
  { id: 'housekeeping',label: 'Housekeeping',         icon: '🧹' },
  { id: 'security',    label: 'Security',             icon: '🔒' },
  { id: 'it_network',  label: 'IT / Network',         icon: '📡' },
  { id: 'other',       label: 'Other',                icon: '📋' },
];

export const PRIORITY_LEVELS = [
  { id: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
  { id: 'high',     label: 'High',     color: '#ea580c', bg: '#fff7ed' },
  { id: 'medium',   label: 'Medium',   color: '#d97706', bg: '#fffbeb' },
  { id: 'low',      label: 'Low',      color: '#3b82f6', bg: '#eff6ff' },
];

export const STATUS_LIST = [
  { id: 'new',          label: 'New',             color: '#6366f1' },
  { id: 'ai_processing',label: 'AI Processing',   color: '#8b5cf6' },
  { id: 'awaiting_review', label: 'Awaiting Review', color: '#f59e0b' },
  { id: 'in_progress',  label: 'In Progress',     color: '#0ea5e9' },
  { id: 'resolved',     label: 'Resolved',        color: '#22c55e' },
];

export const TENANTS = [
  { id: 'T001', name: 'Jollibee',                floor: 'GF', zone: 'A', contact: 'Maria Santos',     phone: '0917-111-0001', type: 'Restaurant' },
  { id: 'T002', name: 'Mercury Drug',            floor: 'GF', zone: 'A', contact: 'Jose Reyes',       phone: '0918-222-0002', type: 'Pharmacy' },
  { id: 'T003', name: 'Bench',                   floor: 'GF', zone: 'B', contact: 'Ana Cruz',         phone: '0919-333-0003', type: 'Fashion' },
  { id: 'T004', name: 'Penshoppe',               floor: 'GF', zone: 'B', contact: 'Carlo Mendoza',    phone: '0920-444-0004', type: 'Fashion' },
  { id: 'T005', name: 'Potato Corner',           floor: 'GF', zone: 'C', contact: 'Liza Bautista',    phone: '0921-555-0005', type: 'Food Stall' },
  { id: 'T006', name: 'Goldilocks',              floor: 'GF', zone: 'C', contact: 'Pedro Garcia',     phone: '0922-666-0006', type: 'Bakery' },
  { id: 'T007', name: 'Watsons',                 floor: 'GF', zone: 'D', contact: 'Rosa Villanueva',  phone: '0923-777-0007', type: 'Health & Beauty' },
  { id: 'T008', name: 'National Book Store',     floor: 'GF', zone: 'D', contact: 'Mark Aquino',      phone: '0924-888-0008', type: 'Bookstore' },
  { id: 'T009', name: 'BDO Branch',              floor: 'GF', zone: 'A', contact: 'Luis Dela Cruz',   phone: '0925-999-0009', type: 'Bank' },
  { id: 'T010', name: 'Globe Store',             floor: 'GF', zone: 'B', contact: 'Jenny Ramos',      phone: '0926-111-0010', type: 'Telecom' },
  { id: 'T011', name: 'Mang Inasal',             floor: '2F', zone: 'A', contact: 'Ricardo Flores',   phone: '0917-222-0011', type: 'Restaurant' },
  { id: 'T012', name: 'Greenwich',               floor: '2F', zone: 'A', contact: 'Elena Torres',     phone: '0918-333-0012', type: 'Restaurant' },
  { id: 'T013', name: 'SM Appliances',           floor: '2F', zone: 'B', contact: 'Danny Lim',        phone: '0919-444-0013', type: 'Appliances' },
  { id: 'T014', name: 'Miniso',                  floor: '2F', zone: 'B', contact: 'Grace Tan',        phone: '0920-555-0014', type: 'Variety Store' },
  { id: 'T015', name: "Levi's",                  floor: '2F', zone: 'C', contact: 'Kevin Soriano',    phone: '0921-666-0015', type: 'Fashion' },
  { id: 'T016', name: 'Giordano',                floor: '2F', zone: 'C', contact: 'Beth Navarro',     phone: '0922-777-0016', type: 'Fashion' },
  { id: 'T017', name: 'David\'s Salon',          floor: '2F', zone: 'D', contact: 'Sharon Dizon',     phone: '0923-888-0017', type: 'Salon' },
  { id: 'T018', name: 'Optical Media',           floor: '2F', zone: 'D', contact: 'Andrew Pascual',   phone: '0924-999-0018', type: 'Electronics' },
  { id: 'T019', name: 'Chowking',                floor: '2F', zone: 'A', contact: 'Mylene Castillo',  phone: '0925-111-0019', type: 'Restaurant' },
  { id: 'T020', name: 'Ace Hardware',             floor: '2F', zone: 'B', contact: 'Raul Morales',     phone: '0926-222-0020', type: 'Hardware' },
  { id: 'T021', name: 'Samsung Store',           floor: '3F', zone: 'A', contact: 'Ian Villanueva',   phone: '0917-333-0021', type: 'Electronics' },
  { id: 'T022', name: 'Huawei Experience Store', floor: '3F', zone: 'A', contact: 'Carla Fernandez',  phone: '0918-444-0022', type: 'Electronics' },
  { id: 'T023', name: 'CD-R King',               floor: '3F', zone: 'B', contact: 'Ronnie Mercado',   phone: '0919-555-0023', type: 'Electronics' },
  { id: 'T024', name: 'Power Mac Center',        floor: '3F', zone: 'B', contact: 'Diana Cruz',       phone: '0920-666-0024', type: 'Electronics' },
  { id: 'T025', name: 'Timezone',                floor: '3F', zone: 'C', contact: 'Bryan Abad',       phone: '0921-777-0025', type: 'Entertainment' },
  { id: 'T026', name: 'Tom\'s World',            floor: '3F', zone: 'C', contact: 'Mae Santos',       phone: '0922-888-0026', type: 'Entertainment' },
  { id: 'T027', name: 'Surplus Shop',            floor: '3F', zone: 'D', contact: 'Noel Aguilar',     phone: '0923-999-0027', type: 'Retail' },
  { id: 'T028', name: 'Handyman',                floor: '3F', zone: 'D', contact: 'Tess Lacson',      phone: '0924-111-0028', type: 'Hardware' },
  { id: 'T029', name: 'KFC',                     floor: '3F', zone: 'A', contact: 'Oliver Salazar',   phone: '0925-222-0029', type: 'Restaurant' },
  { id: 'T030', name: 'Tokyo Tokyo',             floor: '3F', zone: 'B', contact: 'Vivian Corpuz',    phone: '0926-333-0030', type: 'Restaurant' },
  { id: 'T031', name: 'Max\'s Restaurant',       floor: '4F', zone: 'A', contact: 'George Pineda',    phone: '0917-444-0031', type: 'Restaurant' },
  { id: 'T032', name: 'Shakey\'s',               floor: '4F', zone: 'A', contact: 'Nina Flores',      phone: '0918-555-0032', type: 'Restaurant' },
  { id: 'T033', name: 'BonChon',                 floor: '4F', zone: 'B', contact: 'Alvin Rivera',     phone: '0919-666-0033', type: 'Restaurant' },
  { id: 'T034', name: 'Pepper Lunch',            floor: '4F', zone: 'B', contact: 'Jasmine Ocampo',   phone: '0920-777-0034', type: 'Restaurant' },
  { id: 'T035', name: 'Cinnabon',                floor: '4F', zone: 'C', contact: 'Victor Bello',     phone: '0921-888-0035', type: 'Cafe' },
  { id: 'T036', name: 'Starbucks',               floor: '4F', zone: 'C', contact: 'Christine Yu',     phone: '0922-999-0036', type: 'Cafe' },
  { id: 'T037', name: 'The SM Store',            floor: 'GF', zone: 'A', contact: 'Joel Manalo',      phone: '0923-111-0037', type: 'Department Store' },
  { id: 'T038', name: 'Toby\'s Sports',          floor: '2F', zone: 'C', contact: 'Patrick David',    phone: '0924-222-0038', type: 'Sports' },
  { id: 'T039', name: 'Anson\'s',                floor: '2F', zone: 'D', contact: 'Rebecca Tan',      phone: '0925-333-0039', type: 'Appliances' },
  { id: 'T040', name: 'Fully Booked',            floor: '3F', zone: 'C', contact: 'Martin Lim',       phone: '0926-444-0040', type: 'Bookstore' },
  { id: 'T041', name: 'Swatch',                  floor: 'GF', zone: 'C', contact: 'Lea Gutierrez',    phone: '0917-555-0041', type: 'Accessories' },
  { id: 'T042', name: 'Pandora',                 floor: 'GF', zone: 'D', contact: 'Irene dela Rosa',  phone: '0918-666-0042', type: 'Jewelry' },
  { id: 'T043', name: 'H&M',                     floor: '2F', zone: 'A', contact: 'Ryan Sy',          phone: '0919-777-0043', type: 'Fashion' },
  { id: 'T044', name: 'Uniqlo',                  floor: '2F', zone: 'B', contact: 'Joyce Magalona',   phone: '0920-888-0044', type: 'Fashion' },
  { id: 'T045', name: 'Krispy Kreme',            floor: '4F', zone: 'D', contact: 'Francis Ong',      phone: '0921-999-0045', type: 'Cafe' },
  { id: 'T046', name: 'J.CO Donuts',             floor: '4F', zone: 'D', contact: 'Mariel Barreto',   phone: '0922-111-0046', type: 'Cafe' },
  { id: 'T047', name: 'Bo\'s Coffee',            floor: '4F', zone: 'C', contact: 'Nelson Aragon',    phone: '0923-222-0047', type: 'Cafe' },
  { id: 'T048', name: 'Dental Care Clinic',      floor: '3F', zone: 'D', contact: 'Dr. Cathy Reyes',  phone: '0924-333-0048', type: 'Clinic' },
  { id: 'T049', name: 'ML Kwarta Padala',        floor: 'GF', zone: 'D', contact: 'Randy Dela Cruz',  phone: '0925-444-0049', type: 'Remittance' },
  { id: 'T050', name: 'LBC Express',             floor: 'GF', zone: 'C', contact: 'Susan Alvarez',    phone: '0926-555-0050', type: 'Courier' },
];

export const STAFF = [
  { id: 'S01', name: 'Engr. Roberto Manansala', role: 'Chief Engineer',       avatar: '👷' },
  { id: 'S02', name: 'Mario Dela Vega',         role: 'Electrician',          avatar: '🔌' },
  { id: 'S03', name: 'Jun Alvarez',             role: 'Plumber',             avatar: '🔧' },
  { id: 'S04', name: 'Dennis Soriano',          role: 'HVAC Technician',     avatar: '❄️' },
  { id: 'S05', name: 'Arnold Bautista',         role: 'General Maintenance', avatar: '🛠️' },
  { id: 'S06', name: 'Rex Cayetano',            role: 'IT Support',          avatar: '💻' },
  { id: 'S07', name: 'Joel Pangilinan',         role: 'Pest Control',        avatar: '🐛' },
  { id: 'S08', name: 'Nestor Roque',            role: 'Security Officer',    avatar: '🔒' },
];

/* ---------- Sample Issues (pre-populated for demo) ---------- */

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(Math.floor(Math.random() * 12) + 7, Math.floor(Math.random() * 60));
  return d.toISOString();
}

export const SAMPLE_ISSUES = [
  {
    id: 'ISS-001', tenantId: 'T001', category: 'hvac', selfAssessment: 'urgent',
    status: 'in_progress', assignedTo: 'S04',
    text: 'Yung aircon sa store namin parang hindi na gumagana, sobrang init na dito. Naka-full blast na pero parang hangin lang lumalabas, hindi malamig.',
    aiCategory: 'hvac', aiConfidence: 94, aiPriority: 82, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(1), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-002', tenantId: 'T005', category: 'plumbing', selfAssessment: 'urgent',
    status: 'awaiting_review', assignedTo: null,
    text: 'May malaking leak po sa banyo, yung tubig tumutulo from the ceiling. Baka may basag na pipe sa taas namin. Medyo nakakaalarma na po.',
    aiCategory: 'plumbing', aiConfidence: 97, aiPriority: 91, aiPriorityLevel: 'critical',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(0), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-003', tenantId: 'T021', category: 'electrical', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Nagf-flicker po yung ilaw dito sa store, on and off siya the whole day. Minsan nag-bbrown out din for a few seconds. Baka may loose wiring.',
    aiCategory: 'electrical', aiConfidence: 91, aiPriority: 75, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(0), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-004', tenantId: 'T037', category: 'elevator', selfAssessment: 'urgent',
    status: 'in_progress', assignedTo: 'S01',
    text: 'The elevator near our area got stuck earlier with customers inside. It took about 10 minutes before it started moving again. Please check immediately.',
    aiCategory: 'elevator', aiConfidence: 96, aiPriority: 95, aiPriorityLevel: 'critical',
    aiLanguage: 'English', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(2), updatedAt: daysAgo(1),
  },
  {
    id: 'ISS-005', tenantId: 'T017', category: 'pest', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Maraming ipis na lumalabas sa drain ng salon namin, lalo na pag gabi. Nakakahiya sa mga customer. Kailangan na siguro ng fumigation.',
    aiCategory: 'pest', aiConfidence: 93, aiPriority: 58, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(1), updatedAt: daysAgo(1),
  },
  {
    id: 'ISS-006', tenantId: 'T036', category: 'plumbing', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S03',
    text: 'The faucet in our back area has been dripping non-stop for 3 days. Not urgent but it\'s wasting water.',
    aiCategory: 'plumbing', aiConfidence: 95, aiPriority: 32, aiPriorityLevel: 'low',
    aiLanguage: 'English', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(5), updatedAt: daysAgo(2),
  },
  {
    id: 'ISS-007', tenantId: 'T025', category: 'electrical', selfAssessment: 'urgent',
    status: 'awaiting_review', assignedTo: null,
    text: 'Nag-spark po yung outlet sa may arcade area, amoy sunog na rin. Hindi namin magamit yung section na yun. Need urgent fix po.',
    aiCategory: 'electrical', aiConfidence: 92, aiPriority: 93, aiPriorityLevel: 'critical',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(0), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-008', tenantId: 'T003', category: 'housekeeping', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S05',
    text: 'Yung hallway sa harap ng store namin medyo madumi, especially yung tiles. Sana ma-deep clean po.',
    aiCategory: 'housekeeping', aiConfidence: 89, aiPriority: 25, aiPriorityLevel: 'low',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(7), updatedAt: daysAgo(5),
  },
  {
    id: 'ISS-009', tenantId: 'T010', category: 'it_network', selfAssessment: 'medium',
    status: 'in_progress', assignedTo: 'S06',
    text: 'Sobrang bagal ng internet connection namin, hindi makapag-process ng transactions. Yung POS system namin affected. Paki-check po yung network.',
    aiCategory: 'it_network', aiConfidence: 88, aiPriority: 72, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(1), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-010', tenantId: 'T031', category: 'fire_safety', selfAssessment: 'urgent',
    status: 'in_progress', assignedTo: 'S01',
    text: 'Na-notice namin na expired na yung fire extinguisher sa may corridor near our store. Also, yung emergency exit sign hindi na nag-iilaw.',
    aiCategory: 'fire_safety', aiConfidence: 90, aiPriority: 88, aiPriorityLevel: 'critical',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(3), updatedAt: daysAgo(2),
  },
  {
    id: 'ISS-011', tenantId: 'T044', category: 'structural', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'May crack na lumalaki sa dingding ng fitting room namin. Around 2 feet long na siya. Baka kailangan na i-check for safety.',
    aiCategory: 'structural', aiConfidence: 87, aiPriority: 65, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(2), updatedAt: daysAgo(2),
  },
  {
    id: 'ISS-012', tenantId: 'T013', category: 'hvac', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Maingay po yung aircon unit, may kung anong kalampag. Parang may loose part sa loob. Nakakaistorbo sa customers.',
    aiCategory: 'hvac', aiConfidence: 91, aiPriority: 52, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(3), updatedAt: daysAgo(3),
  },
  {
    id: 'ISS-013', tenantId: 'T042', category: 'security', selfAssessment: 'medium',
    status: 'resolved', assignedTo: 'S08',
    text: 'Yung CCTV camera na nakaharap sa store namin mukhang sira, hindi na umiikot. Also the lighting near our area is too dim at night.',
    aiCategory: 'security', aiConfidence: 85, aiPriority: 60, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(8), updatedAt: daysAgo(4),
  },
  {
    id: 'ISS-014', tenantId: 'T011', category: 'plumbing', selfAssessment: 'urgent',
    status: 'in_progress', assignedTo: 'S03',
    text: 'Hindi gumagana yung kitchen sink drain, nag-ooverflow na yung tubig. Hindi kami makapagluto kasi baha na sa area. Help po ASAP!',
    aiCategory: 'plumbing', aiConfidence: 96, aiPriority: 89, aiPriorityLevel: 'critical',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(0), updatedAt: daysAgo(0),
  },
  {
    id: 'ISS-015', tenantId: 'T048', category: 'electrical', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Brownout sa clinic namin kanina, around 30 minutes nawalan ng kuryente. Yung mga gamit namin like autoclave need continuous power.',
    aiCategory: 'electrical', aiConfidence: 88, aiPriority: 78, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(1), updatedAt: daysAgo(1),
  },
  {
    id: 'ISS-016', tenantId: 'T007', category: 'housekeeping', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S05',
    text: 'May kung anong amoy na hindi maganda coming from the air vent sa store namin. Parang damp or moldy smell.',
    aiCategory: 'housekeeping', aiConfidence: 72, aiPriority: 40, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(10), updatedAt: daysAgo(6),
  },
  {
    id: 'ISS-017', tenantId: 'T023', category: 'it_network', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S06',
    text: 'Wifi connection keeps disconnecting every few minutes. Our cashier system needs stable internet for card payments.',
    aiCategory: 'it_network', aiConfidence: 90, aiPriority: 55, aiPriorityLevel: 'medium',
    aiLanguage: 'English', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(6), updatedAt: daysAgo(4),
  },
  {
    id: 'ISS-018', tenantId: 'T033', category: 'pest', selfAssessment: 'medium',
    status: 'in_progress', assignedTo: 'S07',
    text: 'May daga po na nakita ng staff namin sa storage area. Pangalawang beses na this week. Kailangan na po ng immediate pest control.',
    aiCategory: 'pest', aiConfidence: 95, aiPriority: 70, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(2), updatedAt: daysAgo(1),
  },
  {
    id: 'ISS-019', tenantId: 'T040', category: 'structural', selfAssessment: 'low',
    status: 'awaiting_review', assignedTo: null,
    text: 'Yung ceiling tiles sa loob ng store namin may stain, parang tubig yung cause. Baka may leak sa taas.',
    aiCategory: 'structural', aiConfidence: 78, aiPriority: 48, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(4), updatedAt: daysAgo(4),
  },
  {
    id: 'ISS-020', tenantId: 'T009', category: 'security', selfAssessment: 'medium',
    status: 'resolved', assignedTo: 'S08',
    text: 'The automatic sliding door at our entrance is not closing properly. Sometimes it stays open kahit walang tao. Security concern po ito.',
    aiCategory: 'security', aiConfidence: 82, aiPriority: 62, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(9), updatedAt: daysAgo(6),
  },
  {
    id: 'ISS-021', tenantId: 'T015', category: 'hvac', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S04',
    text: 'Yung thermostat sa store namin stuck sa 18°C, hindi na namin ma-adjust. Sobrang lamig para sa customers.',
    aiCategory: 'hvac', aiConfidence: 93, aiPriority: 38, aiPriorityLevel: 'low',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(12), updatedAt: daysAgo(8),
  },
  {
    id: 'ISS-022', tenantId: 'T046', category: 'electrical', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S02',
    text: 'One of our display case lights burned out. It\'s the one on the left side of the donut display. Low priority but affects presentation.',
    aiCategory: 'electrical', aiConfidence: 86, aiPriority: 22, aiPriorityLevel: 'low',
    aiLanguage: 'English', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(14), updatedAt: daysAgo(10),
  },
  {
    id: 'ISS-023', tenantId: 'T019', category: 'plumbing', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Mababa yung water pressure sa kitchen namin, mahirap maglinis ng dishes. Parang ganito na siya for a week na.',
    aiCategory: 'plumbing', aiConfidence: 91, aiPriority: 50, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(3), updatedAt: daysAgo(3),
  },
  {
    id: 'ISS-024', tenantId: 'T029', category: 'fire_safety', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Nag-beep yung smoke detector sa kitchen area namin kanina pero walang fire. Baka need recalibration or cleaning.',
    aiCategory: 'fire_safety', aiConfidence: 84, aiPriority: 55, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(2), updatedAt: daysAgo(2),
  },
  {
    id: 'ISS-025', tenantId: 'T026', category: 'elevator', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S01',
    text: 'Yung escalator sa 3rd floor madalas huminto, lalo na pag maraming tao. Parang overloaded siguro.',
    aiCategory: 'elevator', aiConfidence: 89, aiPriority: 60, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(11), updatedAt: daysAgo(7),
  },
  {
    id: 'ISS-026', tenantId: 'T002', category: 'hvac', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'May water dripping from our AC unit, yung condensation parang hindi na nag-ddrain properly. Nababasa yung sahig near the counter.',
    aiCategory: 'hvac', aiConfidence: 90, aiPriority: 56, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(1), updatedAt: daysAgo(1),
  },
  {
    id: 'ISS-027', tenantId: 'T034', category: 'housekeeping', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S05',
    text: 'The restroom nearest to our store has been out of soap and tissue since yesterday. Customers complain to us about it.',
    aiCategory: 'housekeeping', aiConfidence: 92, aiPriority: 35, aiPriorityLevel: 'low',
    aiLanguage: 'English', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(6), updatedAt: daysAgo(5),
  },
  {
    id: 'ISS-028', tenantId: 'T043', category: 'structural', selfAssessment: 'medium',
    status: 'in_progress', assignedTo: 'S05',
    text: 'Yung glass door ng store namin may hairline crack na, baka kung sino makasalubong. Need replacement na siguro.',
    aiCategory: 'structural', aiConfidence: 85, aiPriority: 68, aiPriorityLevel: 'high',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(4), updatedAt: daysAgo(2),
  },
  {
    id: 'ISS-029', tenantId: 'T050', category: 'electrical', selfAssessment: 'medium',
    status: 'awaiting_review', assignedTo: null,
    text: 'Yung signage light namin sa labas ng store nag-flicker, tapos may buzzing sound. Parang may problema sa transformer or ballast.',
    aiCategory: 'electrical', aiConfidence: 87, aiPriority: 45, aiPriorityLevel: 'medium',
    aiLanguage: 'Taglish', validated: false, validatedBy: null,
    submittedAt: daysAgo(3), updatedAt: daysAgo(3),
  },
  {
    id: 'ISS-030', tenantId: 'T014', category: 'other', selfAssessment: 'low',
    status: 'resolved', assignedTo: 'S05',
    text: 'Requesting additional power outlets sa store namin. Yung existing outlets kulang na for our new display racks.',
    aiCategory: 'electrical', aiConfidence: 68, aiPriority: 20, aiPriorityLevel: 'low',
    aiLanguage: 'Taglish', validated: true, validatedBy: 'Admin',
    submittedAt: daysAgo(15), updatedAt: daysAgo(9),
  },
];

/* ---------- Historical Data for Analytics (6 months) ---------- */

const MONTHS_LABELS = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'];

export const HISTORICAL_DATA = {
  months: MONTHS_LABELS,

  /* Issues submitted per month */
  issuesByMonth: [42, 38, 55, 48, 61, 53],

  /* Issues by category per month */
  categoryTrends: {
    electrical:   [8, 6, 10, 9, 12, 10],
    plumbing:     [7, 8, 9, 7, 10, 8],
    hvac:         [10, 7, 12, 11, 13, 11],
    structural:   [3, 4, 5, 4, 5, 4],
    pest:         [4, 3, 5, 4, 6, 5],
    elevator:     [2, 2, 3, 3, 4, 3],
    fire_safety:  [1, 2, 2, 2, 2, 2],
    housekeeping: [4, 3, 5, 4, 5, 6],
    security:     [2, 2, 3, 3, 3, 3],
    it_network:   [1, 1, 1, 1, 1, 1],
  },

  /* Priority distribution per month */
  priorityTrends: {
    critical: [5, 4, 8, 6, 9, 7],
    high:     [10, 9, 13, 11, 15, 13],
    medium:   [17, 15, 21, 19, 23, 20],
    low:      [10, 10, 13, 12, 14, 13],
  },

  /* Avg resolution time in hours by category */
  avgResolutionTime: {
    electrical: 18, plumbing: 14, hvac: 24, structural: 72,
    pest: 48, elevator: 8, fire_safety: 4, housekeeping: 6,
    security: 12, it_network: 10,
  },

  /* AI accuracy per month (%) */
  aiAccuracy: [78, 82, 85, 87, 89, 91],

  /* Budget estimates per category (PHP) */
  budgetByCategory: {
    electrical: 185000, plumbing: 142000, hvac: 310000, structural: 420000,
    pest: 95000, elevator: 280000, fire_safety: 120000, housekeeping: 65000,
    security: 98000, it_network: 75000,
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
