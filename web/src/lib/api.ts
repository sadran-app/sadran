// Thin typed client. Vite proxies /api → the Fastify server.

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEKEND_DAYS = [5, 6];

export type AvailabilityState = 'ok' | 'prefer' | 'cant';

export interface Role {
  id: string;
  name: string;
}
export interface ShiftSlot {
  id: string;
  shiftId: string;
  roleId: string;
  startTime: string;
  count: number;
}
export interface Shift {
  id: string;
  dayIndex: number;
  label: string;
  startTime: string;
  endTime: string;
  order: number;
  colorTier: number;
  slots: ShiftSlot[];
}
export interface LaborRules {
  minRestHours: number;
  maxWeeklyHours: number;
  maxDailyHours: number;
  minorCurfewHour: number;
  closingHour: number;
}

export interface Candidate {
  id: string;
  name: string;
  isMinor: boolean;
  ok: boolean;
  reasons: string[];
}
export interface Automation {
  autoMessage: string;
  autoSendDay: number;
  autoSendTime: string;
}
export interface Config {
  org: { id: string; name: string; timezone: string };
  laborRules: LaborRules;
  automation: Automation;
  roles: Role[];
  shifts: Shift[];
}

export interface CycleSummary {
  id: string;
  weekStartDate: string;
  status: string;
  shifts: number;
  hours: number;
  laborCost: number;
  coverageRate: number;
  gaps: number;
}
export interface AvailabilityStatus {
  cycleId: string;
  employees: { id: string; name: string; responded: boolean }[];
}

export interface EmployeeAvailability {
  shiftId: string;
  state: AvailabilityState;
}
export interface Employee {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  minShifts: number;
  maxShifts: number;
  isMinor: boolean;
  birthDate: string | null;
  age: number | null;
  hourlyRate: number;
  active: boolean;
  optInStatus: string;
  fairnessCredit: number;
  roleIds: string[];
  availability: EmployeeAvailability[];
}
export interface NewEmployee {
  name: string;
  phone: string;
  email?: string;
  birthDate?: string;
  hourlyRate?: number;
  minShifts?: number;
  maxShifts?: number;
  roleIds: string[];
}

export interface Assignment {
  id: string;
  employeeId: string;
  employeeName: string;
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  status: string;
}
export interface Gap {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  required: number;
  filled: number;
  missing: number;
}
export interface Fairness {
  employeeId: string;
  undesirableLoad: number;
  count: number;
}
export interface CycleView {
  cycle: { id: string; weekStartDate: string; status: string };
  assignments: Assignment[];
  gaps: Gap[];
  fairness: Fairness[];
}

export interface SwapView {
  id: string;
  status: string;
  createdAt: string;
  claimedById: string | null;
  claimedByName: string | null;
  assignment: {
    id: string;
    dayIndex: number;
    blockLabel: string;
    waveTime: string;
    roleName: string;
    holderName: string;
  };
}

export interface OutboxMessage {
  id: string;
  employeeId: string;
  kind: string;
  body: string;
  createdAt: string;
}

export interface EmployeeReport {
  id: string;
  name: string;
  active: boolean;
  isMinor: boolean;
  age: number | null;
  optInStatus: string;
  roleNames: string[];
  shifts: number;
  hours: number;
  laborCost: number;
  weekendShifts: number;
  closingShifts: number;
  undesirableLoad: number;
  swapOuts: number;
  swapIns: number;
  avgShiftsPerWeek: number;
  belowMin: boolean;
}
export interface OrgReport {
  summary: {
    activeEmployees: number;
    minors: number;
    weeks: number;
    totalShifts: number;
    totalHours: number;
    totalLaborCost: number;
    coverageRate: number;
    openGaps: number;
    pendingSwaps: number;
    totalSwaps: number;
    avgHoursPerEmployee: number;
  };
  employees: EmployeeReport[];
}

export interface AuthResult {
  token: string;
  manager: { id: string; name: string; email: string };
  org: { id: string; name: string } | null;
  isAdmin: boolean;
}

export interface Business {
  id: string;
  name: string;
  managerName: string;
  managerEmail: string;
  employees: number;
}

const TOKEN_KEY = 'sadran_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('sadran-unauth'));
    throw new Error('פג תוקף ההתחברות — התחבר מחדש');
  }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    let text = typeof msg.error === 'string' ? msg.error : `שגיאה ${res.status}`;
    if (Array.isArray(msg.reasons) && msg.reasons.length) text += ': ' + msg.reasons.join(' · ');
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: async (email: string, password: string) => {
    const r = await req<AuthResult>('/api/auth/login', 'POST', { email, password });
    setToken(r.token);
    return r;
  },
  me: () => req<{ manager: AuthResult['manager'] | null; org: AuthResult['org']; isAdmin: boolean }>('/api/auth/me'),
  logout: () => clearToken(),

  listBusinesses: () => req<Business[]>('/api/admin/businesses'),
  createBusiness: (data: { businessName: string; managerName: string; email: string; password: string }) =>
    req<{ id: string; name: string; managerEmail: string }>('/api/admin/businesses', 'POST', data),
  deleteBusiness: (id: string) => req<{ ok: true }>(`/api/admin/businesses/${id}`, 'DELETE'),

  getConfig: () => req<Config>('/api/config'),
  updateLaborRules: (rules: LaborRules) => req<LaborRules>('/api/config/labor-rules', 'PUT', rules),

  createRole: (name: string) => req<Role>('/api/config/roles', 'POST', { name }),
  updateRole: (id: string, name: string) => req<Role>(`/api/config/roles/${id}`, 'PUT', { name }),
  deleteRole: (id: string) => req<{ ok: true }>(`/api/config/roles/${id}`, 'DELETE'),
  updateAutomation: (a: Automation) => req<Automation>('/api/config/automation', 'PUT', a),

  listCycles: () => req<CycleSummary[]>('/api/cycles'),
  createCycle: (weekStartDate: string) => req<{ id: string }>('/api/cycles', 'POST', { weekStartDate }),
  getCycleDetail: (id: string) => req<CycleView>(`/api/cycles/${id}`),
  availabilityStatus: () => req<AvailabilityStatus>('/api/cycle/availability-status'),
  sendAvailability: () => req<{ sent: number }>('/api/cycle/send-availability', 'POST'),

  createShift: (data: { dayIndex: number; label: string; startTime: string; endTime: string; colorTier?: number }) =>
    req<Shift>('/api/config/shifts', 'POST', data),
  updateShift: (id: string, data: Partial<{ label: string; startTime: string; endTime: string; colorTier: number }>) =>
    req<Shift>(`/api/config/shifts/${id}`, 'PUT', data),
  deleteShift: (id: string) => req<{ ok: true }>(`/api/config/shifts/${id}`, 'DELETE'),
  addSlot: (shiftId: string, data: { roleId: string; startTime: string; count: number }) =>
    req<ShiftSlot>(`/api/config/shifts/${shiftId}/slots`, 'POST', data),
  updateSlot: (id: string, data: Partial<{ roleId: string; startTime: string; count: number }>) =>
    req<ShiftSlot>(`/api/config/slots/${id}`, 'PUT', data),
  deleteSlot: (id: string) => req<{ ok: true }>(`/api/config/slots/${id}`, 'DELETE'),

  getEmployees: () => req<{ cycleId: string; employees: Employee[] }>('/api/employees'),
  createEmployee: (data: NewEmployee) => req<{ id: string; name: string }>('/api/employees', 'POST', data),
  updateEmployee: (
    id: string,
    data: {
      name?: string;
      phone?: string;
      email?: string;
      birthDate?: string;
      hourlyRate?: number;
      minShifts?: number;
      maxShifts?: number;
      active?: boolean;
      roleIds?: string[];
    },
  ) => req<{ ok: true }>(`/api/employees/${id}`, 'PUT', data),
  deactivateEmployee: (id: string) => req<{ ok: true }>(`/api/employees/${id}`, 'DELETE'),
  updateAvailability: (id: string, items: EmployeeAvailability[]) =>
    req<{ ok: true }>(`/api/employees/${id}/availability`, 'PUT', { items }),

  getReports: () => req<OrgReport>('/api/reports'),

  getCycle: () => req<CycleView>('/api/cycle'),
  generate: () => req<{ warnings: string[]; gapCount: number; assigned: number }>('/api/cycle/generate', 'POST'),
  publish: () => req<{ published: number; notified: number }>('/api/cycle/publish', 'POST'),
  addAssignment: (data: { employeeId: string; slotId: string; force?: boolean }) =>
    req<Assignment & { warning?: string[] }>('/api/assignments', 'POST', data),
  candidates: (slotId: string) => req<Candidate[]>(`/api/slots/${slotId}/candidates`),
  deleteAssignment: (id: string) => req<{ ok: true }>(`/api/assignments/${id}`, 'DELETE'),
  eligibleFor: (assignmentId: string) => req<{ id: string; name: string }[]>(`/api/assignments/${assignmentId}/eligible`),

  getSwaps: () => req<SwapView[]>('/api/swaps'),
  vacate: (assignmentId: string) => req<{ swapId: string; notified: number }>(`/api/assignments/${assignmentId}/vacate`, 'POST'),
  claim: (swapId: string, employeeId: string) => req(`/api/swaps/${swapId}/claim`, 'POST', { employeeId }),
  approve: (swapId: string) => req(`/api/swaps/${swapId}/approve`, 'POST'),
  reject: (swapId: string) => req(`/api/swaps/${swapId}/reject`, 'POST'),

  getOutbox: () => req<OutboxMessage[]>('/api/outbox'),
};
