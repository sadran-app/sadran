// Thin typed client. Vite proxies /api → the Fastify server.

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEKEND_DAYS = [5, 6];
export const SUPPORT_EMAIL = 'sadran.app@walla.co.il';

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
  minLevel?: number;
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
  welcomeEnabled: boolean;
  welcomeMessage: string;
  autoSendEnabled: boolean;
}
export interface Config {
  org: { id: string; name: string; timezone: string; businessType: string; employeeQuota: number; activeEmployees: number };
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

export interface MonitorData {
  cycleId: string;
  weekStartDate: string;
  status: string;
  whatsappEnabled: boolean;
  availability: {
    total: number;
    submittedCount: number;
    submitted: { id: string; name: string; at: string }[];
    pending: { id: string; name: string }[];
  };
  issues: {
    nonResponders: { id: string; name: string }[];
    deliveryFailures: { employeeId: string; name: string; kind: string; at: string; detail: string }[];
    noPhone: { id: string; name: string }[];
    optedOut: { id: string; name: string }[];
    pendingOptIn: { id: string; name: string }[];
  };
}

export type DayAvailMode = 'all' | 'off' | 'hours';
export interface EmployeeDayAvailability {
  dayIndex: number;
  mode: DayAvailMode;
  fromTime: string | null;
  toTime: string | null;
}
// 'unset' = no info yet for this day; sent to the server, which stores no row for it.
export type DayAvailInputMode = DayAvailMode | 'unset';
export interface DayAvailInput {
  dayIndex: number;
  mode: DayAvailInputMode;
  fromTime: string | null;
  toTime: string | null;
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
  rank: number;
  employmentNotes: string | null;
  roleIds: string[];
  roleLevels: Record<string, number>; // roleId -> seniority (3.3)
  maxConsecutiveDays: number | null; // 3.3
  dayAvailability: EmployeeDayAvailability[];
  hasAvailability: boolean; // false = no WhatsApp reply and not manually configured yet
}

export interface TimeOff {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'vacation' | 'reserve' | 'sick' | 'other';
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved' | 'rejected';
  source: 'manager' | 'whatsapp';
  note: string | null;
}
export interface StandingRule {
  id: string;
  employeeId: string;
  employeeName: string;
  dayIndex: number;
  mode: 'off' | 'hours';
  fromTime: string | null;
  toTime: string | null;
  status: 'pending' | 'approved';
  source: 'manager' | 'whatsapp';
  note: string | null;
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
  endTime?: string | null;
  status: string;
  forced?: boolean;
  forceReason?: string | null;
  locked?: boolean;
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
  cycle: { id: string; weekStartDate: string; status: string; dayNotes?: Record<string, string> };
  cost?: { labor: number; hours: number; budget: number };
  assignments: Assignment[];
  gaps: Gap[];
  fairness: Fairness[];
}

export interface DemandTemplate { id: string; name: string; createdAt: string; items: number }

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
  phone: string;
  hourlyRate: number;
  shifts: number;
  hours: number;
  laborCost: number;
  weekendShifts: number;
  closingShifts: number;
  undesirableLoad: number;
  undesirablePerWeek: number;
  weeksWorked: number;
  swapOuts: number;
  swapIns: number;
  avgShiftsPerWeek: number;
  belowMin: boolean;
  reliability: number;
  responseRate: number;
  rank: number;
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
    weeklyLaborBudget: number;
    avgWeeklyLaborCost: number;
  };
  employees: EmployeeReport[];
}
export interface TrendPoint {
  cycleId: string;
  weekStartDate: string;
  coveragePct: number;
  laborCost: number;
  hours: number;
  shifts: number;
  forced: number;
  gaps: number;
  fairnessSpread: number;
  revenue: number | null;
  laborPctOfRevenue: number | null;
  budget: number;
}

export interface Conversation {
  employeeId: string;
  name: string;
  phone: string;
  active: boolean;
  lastBody: string | null;
  lastAt: string | null;
  lastDir: 'in' | 'out' | null;
  unread: number;
}
export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  body: string;
  kind: string;
  failed?: boolean;
  mediaUrl?: string | null;
  createdAt: string;
}

export interface Insight {
  id: string;
  severity: 'positive' | 'info' | 'warning';
  title: string;
  detail: string;
  tip?: string;
  employeeName?: string;
}

export interface SlotForecast {
  slotId: string;
  shiftId: string;
  dayIndex: number;
  shiftLabel: string;
  startTime: string;
  roleId: string;
  roleName: string;
  current: number;
  recommended: number;
  avgFilled: number;
  expectedLevel: number;
  weeksOfData: number;
  swaps: number;
  forced: number;
  signals: string[];
}
export interface ShiftLoadEntry {
  shiftId: string;
  dayIndex: number;
  label: string;
  startTime: string;
  endTime: string;
  level: number;
}
export interface ForecastResult {
  publishedWeeks: number;
  loads: ShiftLoadEntry[];
  slots: SlotForecast[];
}
export const LOAD_LEVELS = [
  { level: 1, label: 'שקט' },
  { level: 2, label: 'רגיל' },
  { level: 3, label: 'עמוס' },
  { level: 4, label: 'עמוס מאוד' },
] as const;

export interface AuthResult {
  token: string;
  manager: { id: string; name: string; username: string; email: string };
  org: { id: string; name: string } | null;
  isAdmin: boolean;
}

export interface Business {
  id: string;
  name: string;
  isChain: boolean;
  businessType: string;
  parentId: string | null;
  managerId: string | null;
  managerName: string;
  username: string;
  lastLoginAt: string | null;
  planName: string | null;
  employeeQuota: number;
  employees: number;
  whatsappEnabled: boolean;
  whatsappMessageCount: number;
  waMonthlyBudget: number;
  waBillableThisMonth: number;
  waFreeThisMonth: number;
  monthlyPrice: number;
  status: 'active' | 'suspended' | 'expired';
  subscriptionStart: string;
  subscriptionEnd: string | null;
  daysLeft: number | null;
  waPhoneNumberId: string | null;
  waPhoneDisplay: string | null;
  waSenderName: string | null;
  waProfilePicUrl: string | null;
}

export interface NewBusinessBranch {
  name: string;
  managerName?: string;
  managerPhone?: string; // for the onboarding WhatsApp
  employeeQuota?: number;
}
export interface Dashboard {
  cycle: { id: string; weekStartDate: string; status: 'collecting' | 'proposed' | 'published' };
  coverage: { required: number; filled: number; missing: number; coveragePct: number };
  forced: { id: string; employeeName: string; dayIndex: number; dayName: string; shiftLabel: string; startTime: string; roleName: string; reason: string }[];
  availability: { total: number; responded: number; pending: string[] };
  swaps: { id: string; status: string; dayName: string; shiftLabel: string; startTime: string; roleName: string; holderName: string }[];
  labor: { cost: number; hours: number };
  counts: { assignments: number; forced: number; pendingAvailability: number; openSwaps: number; gaps: number };
}

export interface NewBusiness {
  type: 'single' | 'chain';
  businessType?: 'restaurant' | 'eventHall' | 'store';
  businessName: string;
  managerName: string;
  managerPhone?: string; // username + password are auto-generated; this is where they're sent
  planName?: string;
  employeeQuota?: number;
  whatsappEnabled?: boolean;
  waMonthlyBudget?: number;
  monthlyPrice?: number;
  subscriptionMonths?: number;
  waPhoneNumberId?: string;
  waPhoneDisplay?: string;
  waSenderName?: string;
  waProfilePicUrl?: string;
  branches?: NewBusinessBranch[];
}
// The auto-generated credentials returned right after creation, so the admin sees them.
export interface CreatedBusiness {
  id: string;
  name: string;
  username: string;
  password: string;
  branches?: { id: string; name: string; username: string; password: string }[];
}
export interface BusinessPatch {
  status?: 'active' | 'suspended';
  planName?: string | null;
  employeeQuota?: number;
  whatsappEnabled?: boolean;
  waMonthlyBudget?: number;
  monthlyPrice?: number;
  extendMonths?: number;
  waPhoneNumberId?: string;
  waPhoneDisplay?: string;
  waSenderName?: string;
  waProfilePicUrl?: string;
}
export interface WaUsageDetail {
  total: number;
  free: number;
  billable: number;
  byKind: { kind: string; free: number; billable: number }[];
  budget: number;
  monthStart: string;
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
    // a business whose subscription was suspended/expired mid-session
    if (res.status === 403 && (msg as { blocked?: boolean }).blocked && path !== '/api/auth/login') {
      window.dispatchEvent(new CustomEvent('sadran-blocked', { detail: msg.error }));
    }
    let text = typeof msg.error === 'string' ? msg.error : `שגיאה ${res.status}`;
    if (Array.isArray(msg.reasons) && msg.reasons.length) text += ': ' + msg.reasons.join(' · ');
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: async (username: string, password: string) => {
    const r = await req<AuthResult>('/api/auth/login', 'POST', { username, password });
    setToken(r.token);
    return r;
  },
  me: () => req<{ manager: AuthResult['manager'] | null; org: AuthResult['org']; isAdmin: boolean }>('/api/auth/me'),
  logout: () => clearToken(),
  changePassword: (username: string, currentPassword: string, newPassword: string) =>
    req<{ ok: true }>('/api/auth/change-password', 'POST', { username: username.trim(), currentPassword, newPassword }),

  listBusinesses: () => req<Business[]>('/api/admin/businesses'),
  waUsage: (id: string) => req<WaUsageDetail>(`/api/admin/businesses/${id}/wa-usage`),
  createBusiness: (data: NewBusiness) => req<CreatedBusiness>('/api/admin/businesses', 'POST', data),
  updateBusiness: (id: string, patch: BusinessPatch) => req<Business>(`/api/admin/businesses/${id}`, 'PATCH', patch),
  revealBusiness: (id: string, password: string) =>
    req<{ username: string; password: string }>(`/api/admin/businesses/${id}/reveal`, 'POST', { password }),
  resetBusinessPassword: (id: string, password: string, username?: string) =>
    req<{ ok: true }>(`/api/admin/businesses/${id}/reset-password`, 'POST', { password, username }),
  impersonateBusiness: (id: string) =>
    req<{ token: string; org: { id: string; name: string } }>(`/api/admin/businesses/${id}/impersonate`, 'POST'),
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
  monitor: () => req<MonitorData>('/api/cycle/monitor'),
  sendAvailability: () => req<{ sent: number }>('/api/cycle/send-availability', 'POST'),

  createShift: (data: { dayIndex: number; label: string; startTime: string; endTime: string; colorTier?: number }) =>
    req<Shift>('/api/config/shifts', 'POST', data),
  updateShift: (id: string, data: Partial<{ label: string; startTime: string; endTime: string; colorTier: number }>) =>
    req<Shift>(`/api/config/shifts/${id}`, 'PUT', data),
  deleteShift: (id: string) => req<{ ok: true }>(`/api/config/shifts/${id}`, 'DELETE'),
  reorderShifts: (dayIndex: number, orderedIds: string[]) => req<{ ok: true }>('/api/config/reorder-shifts', 'PUT', { dayIndex, orderedIds }),
  addSlot: (shiftId: string, data: { roleId: string; startTime: string; count: number; minLevel?: number }) =>
    req<ShiftSlot>(`/api/config/shifts/${shiftId}/slots`, 'POST', data),
  updateSlot: (id: string, data: Partial<{ roleId: string; startTime: string; count: number; minLevel: number }>) =>
    req<ShiftSlot>(`/api/config/slots/${id}`, 'PUT', data),
  deleteSlot: (id: string) => req<{ ok: true }>(`/api/config/slots/${id}`, 'DELETE'),

  // 3.1 time-off
  getTimeOff: () => req<TimeOff[]>('/api/time-off'),
  createTimeOff: (data: { employeeId: string; type: string; startDate: string; endDate: string; note?: string }) =>
    req<TimeOff>('/api/time-off', 'POST', data),
  setTimeOffStatus: (id: string, status: 'approved' | 'rejected' | 'pending') => req<{ ok: true }>(`/api/time-off/${id}`, 'PUT', { status }),
  deleteTimeOff: (id: string) => req<{ ok: true }>(`/api/time-off/${id}`, 'DELETE'),
  // 3.2 standing rules
  getStandingRules: () => req<StandingRule[]>('/api/standing-rules'),
  createStandingRule: (data: { employeeId: string; dayIndex: number; mode: 'off' | 'hours'; fromTime?: string; toTime?: string; note?: string }) =>
    req<StandingRule>('/api/standing-rules', 'POST', data),
  setStandingRuleStatus: (id: string, status: 'approved' | 'pending') => req<{ ok: true }>(`/api/standing-rules/${id}`, 'PUT', { status }),
  deleteStandingRule: (id: string) => req<{ ok: true }>(`/api/standing-rules/${id}`, 'DELETE'),

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
      roleLevels?: Record<string, number>;
      maxConsecutiveDays?: number | null;
      employmentNotes?: string;
    },
  ) => req<{ ok: true }>(`/api/employees/${id}`, 'PUT', data),
  deactivateEmployee: (id: string) => req<{ ok: true }>(`/api/employees/${id}`, 'DELETE'),
  sendEmployeeSummary: (id: string) =>
    req<{ ok: true; summary: { shifts: number; hours: number; weekendShifts: number; closingShifts: number; rank: number } }>(`/api/employees/${id}/send-summary`, 'POST'),
  updateDayAvailability: (id: string, days: DayAvailInput[]) =>
    req<{ ok: true }>(`/api/employees/${id}/day-availability`, 'PUT', { days }),

  getReports: () => req<OrgReport>('/api/reports'),
  getTrends: () => req<TrendPoint[]>('/api/reports/trends'),
  getInsights: () => req<Insight[]>('/api/insights'),
  setLaborBudget: (weeklyLaborBudget: number) => req<{ ok: true }>('/api/config/labor-budget', 'PUT', { weeklyLaborBudget }),
  setRevenue: (revenue: number | null) => req<{ ok: true }>('/api/cycle/revenue', 'PUT', { revenue }),
  getForecast: () => req<ForecastResult>('/api/forecast'),
  applyForecast: (items: { slotId: string; count: number }[]) =>
    req<{ ok: true; updated: number }>('/api/forecast/apply', 'POST', { items }),
  setForecastLoad: (items: { shiftId: string; level: number }[]) =>
    req<{ ok: true; updated: number }>('/api/forecast/load', 'PUT', { items }),
  copilotSuggestions: () => req<{ suggestions: string[] }>('/api/copilot/suggestions'),
  askCopilot: (question: string) => req<{ answer: string; suggestions?: string[] }>('/api/copilot', 'POST', { question }),

  getDashboard: () => req<Dashboard>('/api/dashboard'),
  getCycle: () => req<CycleView>('/api/cycle'),
  generate: (optimize = false) => req<{ warnings: string[]; gapCount: number; assigned: number; engine: 'optimal' | 'greedy' }>('/api/cycle/generate', 'POST', { optimize }),
  publish: () => req<{ published: number; notified: number }>('/api/cycle/publish', 'POST'),
  resetSchedule: () => req<{ ok: true }>('/api/cycle/reset', 'POST'),
  openNext: () => req<{ id: string; weekStartDate: string; status: string }>('/api/cycle/open-next', 'POST'),
  addAssignment: (data: { employeeId: string; slotId: string; force?: boolean }) =>
    req<Assignment & { warning?: string[] }>('/api/assignments', 'POST', data),
  candidates: (slotId: string) => req<Candidate[]>(`/api/slots/${slotId}/candidates`),
  deleteAssignment: (id: string) => req<{ ok: true }>(`/api/assignments/${id}`, 'DELETE'),
  moveAssignment: (id: string, toSlotId: string, force = false) =>
    req<{ warning?: string[]; unchanged?: boolean }>(`/api/assignments/${id}/move`, 'POST', { toSlotId, force }),
  lockAssignment: (id: string, locked: boolean) => req<{ ok: true; locked: boolean }>(`/api/assignments/${id}/lock`, 'PUT', { locked }),
  copyPrevious: () => req<{ copied: number; skipped: number }>('/api/cycle/copy-previous', 'POST'),
  setDayNote: (dayIndex: number, text: string) => req<{ ok: true; dayNotes: Record<string, string> }>('/api/cycle/notes', 'PUT', { dayIndex, text }),
  bulkDemand: (data: { roleId: string; count: number; dayIndexes?: number[]; label?: string }) =>
    req<{ created: number; updated: number; removed: number; shiftsMatched: number }>('/api/config/slots/bulk', 'POST', data),
  getTemplates: () => req<DemandTemplate[]>('/api/demand-templates'),
  saveTemplate: (name: string) => req<DemandTemplate>('/api/demand-templates', 'POST', { name }),
  applyTemplate: (id: string) => req<{ applied: number; unmatched: number }>(`/api/demand-templates/${id}/apply`, 'POST'),
  deleteTemplate: (id: string) => req<{ ok: true }>(`/api/demand-templates/${id}`, 'DELETE'),
  eligibleFor: (assignmentId: string) => req<{ id: string; name: string }[]>(`/api/assignments/${assignmentId}/eligible`),

  getSwaps: () => req<SwapView[]>('/api/swaps'),
  vacate: (assignmentId: string) => req<{ swapId: string; notified: number }>(`/api/assignments/${assignmentId}/vacate`, 'POST'),
  claim: (swapId: string, employeeId: string) => req(`/api/swaps/${swapId}/claim`, 'POST', { employeeId }),
  approve: (swapId: string) => req(`/api/swaps/${swapId}/approve`, 'POST'),
  reject: (swapId: string) => req(`/api/swaps/${swapId}/reject`, 'POST'),

  getOutbox: () => req<OutboxMessage[]>('/api/outbox'),

  chatConversations: () => req<Conversation[]>('/api/chat/conversations'),
  chatThread: (employeeId: string) => req<ChatMessage[]>(`/api/chat/${employeeId}`),
  chatSend: (employeeId: string, body: string) => req<{ ok: true }>(`/api/chat/${employeeId}`, 'POST', { body }),
};
