"use client";

import { useEffect, useMemo, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";

type BranchRow = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; branchId: string | null; branch?: { id: string; name: string } | null };
type EmployeeRow = {
  id: string;
  employeeCode: string;
  title: string | null;
  department: string | null;
  hireDate: string | null;
  payFrequency: string;
  notes: string | null;
  isActive: boolean;
  branch: { id: string; name: string } | null;
  user: { id: string; name: string; email: string; branchId: string | null; isActive: boolean };
  currentCompensation: {
    id: string;
    baseSalary: number;
    allowance: number;
    transportAllowance: number;
    effectiveFrom: string;
    notes: string | null;
  } | null;
  commissionRule: {
    id: string;
    type: string;
    rate: number;
    effectiveFrom: string;
  } | null;
  recentAttendance: Array<{ id: string; date: string; status: string; workedMinutes: number; note: string | null }>;
  leaveRequests: Array<{ id: string; type: string; status: string; startDate: string; endDate: string; reason: string | null }>;
};
type PayrollRunRow = {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  branch: { id: string; name: string } | null;
  items: Array<{
    id: string;
    employee: { id: string; employeeCode: string; user: { id: string; name: string } };
    baseSalary: number;
    allowances: number;
    deductions: number;
    leaveDeduction: number;
    commissions: number;
    overtime: number;
    netPay: number;
    paymentStatus: string;
  }>;
};
type LeaveRow = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  employee: { id: string; employeeCode: string; user: { id: string; name: string } };
};

export default function HrPage() {
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [employeeForm, setEmployeeForm] = useState({
    userId: "",
    employeeCode: "",
    branchId: "",
    title: "",
    department: "",
    baseSalary: "",
    allowance: "",
    transportAllowance: "",
    commissionType: "PERCENT_OF_REVENUE",
    commissionRate: "",
  });
  const [attendanceForm, setAttendanceForm] = useState({
    employeeId: "",
    date: "",
    status: "PRESENT",
    workedMinutes: "480",
    note: "",
  });
  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    type: "ANNUAL",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [payrollForm, setPayrollForm] = useState({
    periodStart: "",
    periodEnd: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      const [branchRes, userRes, employeeRes, leaveRes, payrollRes] = await Promise.all([
        fetch("/api/branches"),
        fetch("/api/users"),
        fetch(`/api/hr/employees?${params.toString()}`),
        fetch(`/api/hr/leave-requests?${params.toString()}`),
        fetch(`/api/hr/payroll-runs?${params.toString()}`),
      ]);
      if (branchRes.ok) {
        const payload = await parseResponseJson<BranchRow[]>(branchRes);
        setBranches(Array.isArray(payload) ? payload : []);
      }
      if (userRes.ok) {
        const payload = await parseResponseJson<{ users: UserRow[] }>(userRes);
        setUsers(payload?.users ?? []);
      }
      if (employeeRes.ok) {
        const payload = await parseResponseJson<{ rows: EmployeeRow[] }>(employeeRes);
        setEmployees(payload?.rows ?? []);
      }
      if (leaveRes.ok) {
        const payload = await parseResponseJson<{ rows: LeaveRow[] }>(leaveRes);
        setLeaveRequests(payload?.rows ?? []);
      }
      if (payrollRes.ok) {
        const payload = await parseResponseJson<{ rows: PayrollRunRow[] }>(payrollRes);
        setPayrollRuns(payload?.rows ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [branchId]);

  const usersWithoutProfiles = useMemo(
    () => users.filter((user) => !employees.some((employee) => employee.user.id === user.id)),
    [employees, users],
  );

  const money = (value: number) =>
    new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP" }).format(value);

  const createEmployeeProfile = async () => {
    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: employeeForm.userId,
        employeeCode: employeeForm.employeeCode,
        branchId: employeeForm.branchId || null,
        title: employeeForm.title || undefined,
        department: employeeForm.department || undefined,
        baseSalary: Number(employeeForm.baseSalary || 0),
        allowance: Number(employeeForm.allowance || 0),
        transportAllowance: Number(employeeForm.transportAllowance || 0),
        commissionType: employeeForm.commissionRate ? employeeForm.commissionType : undefined,
        commissionRate: employeeForm.commissionRate ? Number(employeeForm.commissionRate) : undefined,
      }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not create employee profile"));
      return;
    }
    setStatus("Employee profile created.");
    setEmployeeForm({
      userId: "",
      employeeCode: "",
      branchId: "",
      title: "",
      department: "",
      baseSalary: "",
      allowance: "",
      transportAllowance: "",
      commissionType: "PERCENT_OF_REVENUE",
      commissionRate: "",
    });
    await load();
  };

  const recordAttendance = async () => {
    const res = await fetch("/api/hr/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: attendanceForm.employeeId,
        date: attendanceForm.date,
        status: attendanceForm.status,
        workedMinutes: Number(attendanceForm.workedMinutes || 0),
        note: attendanceForm.note || undefined,
      }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not record attendance"));
      return;
    }
    setStatus("Attendance recorded.");
    setAttendanceForm((current) => ({ ...current, note: "" }));
    await load();
  };

  const createLeaveRequest = async () => {
    const res = await fetch("/api/hr/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leaveForm),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not create leave request"));
      return;
    }
    setStatus("Leave request created.");
    setLeaveForm({ employeeId: "", type: "ANNUAL", startDate: "", endDate: "", reason: "" });
    await load();
  };

  const updateLeaveStatus = async (id: string, nextStatus: "APPROVED" | "REJECTED") => {
    const res = await fetch("/api/hr/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not update leave request"));
      return;
    }
    setStatus("Leave request updated.");
    await load();
  };

  const createPayrollRun = async () => {
    const res = await fetch("/api/hr/payroll-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: branchId || null, ...payrollForm }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not create payroll run"));
      return;
    }
    setStatus("Payroll run created.");
    await load();
  };

  const markPayrollPaid = async (id: string) => {
    const res = await fetch(`/api/hr/payroll-runs/${id}/pay`, { method: "POST" });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not mark payroll as paid"));
      return;
    }
    setStatus("Payroll marked as paid.");
    await load();
  };

  return (
    <AppPage>
      <PageHeader title="HR & Payroll" subtitle="Branch-safe employee, attendance, leave, commission, and payroll management." />

      <Card className="mb-6">
        <SectionTitle title="Scope" />
        <Select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="max-w-sm">
          <option value="">All visible branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        {status ? <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{status}</p> : null}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle title="Create employee profile" />
          <div className="grid grid-cols-1 gap-3">
            <Select value={employeeForm.userId} onChange={(event) => setEmployeeForm((current) => ({ ...current, userId: event.target.value }))}>
              <option value="">Select team member</option>
              {usersWithoutProfiles.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.email}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input value={employeeForm.employeeCode} onChange={(event) => setEmployeeForm((current) => ({ ...current, employeeCode: event.target.value }))} placeholder="Employee code" />
              <Select value={employeeForm.branchId} onChange={(event) => setEmployeeForm((current) => ({ ...current, branchId: event.target.value }))}>
                <option value="">Use staff branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
              <Input value={employeeForm.title} onChange={(event) => setEmployeeForm((current) => ({ ...current, title: event.target.value }))} placeholder="Title" />
              <Input value={employeeForm.department} onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))} placeholder="Department" />
              <Input type="number" min="0" step="0.01" value={employeeForm.baseSalary} onChange={(event) => setEmployeeForm((current) => ({ ...current, baseSalary: event.target.value }))} placeholder="Base salary" />
              <Input type="number" min="0" step="0.01" value={employeeForm.allowance} onChange={(event) => setEmployeeForm((current) => ({ ...current, allowance: event.target.value }))} placeholder="Allowance" />
              <Input type="number" min="0" step="0.01" value={employeeForm.transportAllowance} onChange={(event) => setEmployeeForm((current) => ({ ...current, transportAllowance: event.target.value }))} placeholder="Transport allowance" />
              <Select value={employeeForm.commissionType} onChange={(event) => setEmployeeForm((current) => ({ ...current, commissionType: event.target.value }))}>
                <option value="PERCENT_OF_REVENUE">Commission % of revenue</option>
                <option value="FIXED_PER_SALE">Fixed per sale</option>
                <option value="MARGIN_SHARE">Margin share %</option>
              </Select>
              <Input type="number" min="0" step="0.01" value={employeeForm.commissionRate} onChange={(event) => setEmployeeForm((current) => ({ ...current, commissionRate: event.target.value }))} placeholder="Commission rate" />
            </div>
            <Button type="button" onClick={() => void createEmployeeProfile()}>Create employee</Button>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Attendance & leave" />
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Select value={attendanceForm.employeeId} onChange={(event) => setAttendanceForm((current) => ({ ...current, employeeId: event.target.value }))}>
                <option value="">Employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.user.name}
                  </option>
                ))}
              </Select>
              <Input type="date" value={attendanceForm.date} onChange={(event) => setAttendanceForm((current) => ({ ...current, date: event.target.value }))} />
              <Select value={attendanceForm.status} onChange={(event) => setAttendanceForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="LATE">Late</option>
                <option value="HALF_DAY">Half day</option>
                <option value="LEAVE">Leave</option>
              </Select>
              <Input type="number" min="0" step="1" value={attendanceForm.workedMinutes} onChange={(event) => setAttendanceForm((current) => ({ ...current, workedMinutes: event.target.value }))} placeholder="Worked minutes" />
            </div>
            <Input value={attendanceForm.note} onChange={(event) => setAttendanceForm((current) => ({ ...current, note: event.target.value }))} placeholder="Attendance note" />
            <Button type="button" onClick={() => void recordAttendance()}>Record attendance</Button>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <Select value={leaveForm.employeeId} onChange={(event) => setLeaveForm((current) => ({ ...current, employeeId: event.target.value }))}>
                <option value="">Employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.user.name}
                  </option>
                ))}
              </Select>
              <Select value={leaveForm.type} onChange={(event) => setLeaveForm((current) => ({ ...current, type: event.target.value }))}>
                <option value="ANNUAL">Annual</option>
                <option value="SICK">Sick</option>
                <option value="UNPAID">Unpaid</option>
                <option value="OTHER">Other</option>
              </Select>
              <Input type="date" value={leaveForm.startDate} onChange={(event) => setLeaveForm((current) => ({ ...current, startDate: event.target.value }))} />
              <Input type="date" value={leaveForm.endDate} onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))} />
              <Input value={leaveForm.reason} onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" />
            </div>
            <Button type="button" variant="secondary" onClick={() => void createLeaveRequest()}>Create leave request</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <SectionTitle title="Employees" subtitle={`${employees.length}`} />
        {loading ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading employees...</p> : null}
        {!loading && employees.length === 0 ? <EmptyState title="No employee profiles yet." /> : null}
        <div className="space-y-3">
          {employees.map((employee) => (
            <div key={employee.id} className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{employee.user.name} · {employee.employeeCode}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {employee.branch?.name ?? "Unassigned"} · {employee.title ?? "No title"} · {employee.department ?? "No department"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={employee.isActive ? "success" : "neutral"}>{employee.isActive ? "Active" : "Inactive"}</StatusBadge>
                  <StatusBadge tone="neutral">{employee.payFrequency}</StatusBadge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Base salary</p>
                  <p className="text-lg font-semibold">{money(employee.currentCompensation?.baseSalary ?? 0)}</p>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Fixed allowances</p>
                  <p className="text-lg font-semibold">{money((employee.currentCompensation?.allowance ?? 0) + (employee.currentCompensation?.transportAllowance ?? 0))}</p>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Commission rule</p>
                  <p className="text-lg font-semibold">{employee.commissionRule ? `${employee.commissionRule.type} · ${employee.commissionRule.rate}` : "None"}</p>
                </div>
              </div>
              {employee.leaveRequests.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1 text-sm font-medium">Latest leave requests</p>
                  <ul className="space-y-1 text-sm">
                    {employee.leaveRequests.slice(0, 3).map((leave) => (
                      <li key={leave.id}>
                        {leave.type} · {leave.status} · {new Date(leave.startDate).toLocaleDateString()} to {new Date(leave.endDate).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle title="Leave approvals" subtitle={`${leaveRequests.length}`} />
          <div className="space-y-3">
            {leaveRequests.length === 0 ? <EmptyState title="No leave requests." /> : leaveRequests.map((leave) => (
              <div key={leave.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                <p className="font-medium">{leave.employee.user.name} · {leave.type}</p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {new Date(leave.startDate).toLocaleDateString()} to {new Date(leave.endDate).toLocaleDateString()} · {leave.status}
                </p>
                {leave.status === "PENDING" ? (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" className="text-xs" onClick={() => void updateLeaveStatus(leave.id, "APPROVED")}>Approve</Button>
                    <Button type="button" variant="secondary" className="text-xs" onClick={() => void updateLeaveStatus(leave.id, "REJECTED")}>Reject</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Payroll runs" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Input type="date" value={payrollForm.periodStart} onChange={(event) => setPayrollForm((current) => ({ ...current, periodStart: event.target.value }))} />
            <Input type="date" value={payrollForm.periodEnd} onChange={(event) => setPayrollForm((current) => ({ ...current, periodEnd: event.target.value }))} />
            <Button type="button" onClick={() => void createPayrollRun()}>Create run</Button>
          </div>
          <div className="mt-4 space-y-3">
            {payrollRuns.length === 0 ? <EmptyState title="No payroll runs yet." /> : payrollRuns.map((run) => (
              <div key={run.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium">{run.branch?.name ?? "All visible branches"} · {new Date(run.periodStart).toLocaleDateString()} to {new Date(run.periodEnd).toLocaleDateString()}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {run.items.length} staff · Net payroll {money(run.items.reduce((sum, item) => sum + item.netPay, 0))}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={run.status === "PAID" ? "success" : "warning"}>{run.status}</StatusBadge>
                    {run.status !== "PAID" ? (
                      <Button type="button" variant="secondary" className="text-xs" onClick={() => void markPayrollPaid(run.id)}>
                        Mark paid
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        <th className="py-2 text-start">Employee</th>
                        <th className="py-2 text-start">Base</th>
                        <th className="py-2 text-start">Allowances</th>
                        <th className="py-2 text-start">Commissions</th>
                        <th className="py-2 text-start">Leave deduction</th>
                        <th className="py-2 text-start">Net pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.items.map((item) => (
                        <tr key={item.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2">{item.employee.user.name}</td>
                          <td className="py-2">{money(item.baseSalary)}</td>
                          <td className="py-2">{money(item.allowances)}</td>
                          <td className="py-2">{money(item.commissions)}</td>
                          <td className="py-2">{money(item.leaveDeduction)}</td>
                          <td className="py-2 font-semibold">{money(item.netPay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppPage>
  );
}
