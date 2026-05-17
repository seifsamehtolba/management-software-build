"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import type { AppRole } from "@/lib/appRole";
import {
  describePermissionCount,
  hasPermission,
  LEGACY_ROLE_PERMISSION_PRESETS,
  normalizePermissions,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions";
import { useLang } from "@/lib/i18n";

type BranchOption = { id: string; name: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
  branch?: { id: string; name: string } | null;
};

type ApprovalRow = {
  id: string;
  summary: string;
  routeHint: string | null;
  status: string;
  createdAt: string;
  requester: { id: string; name: string; email: string; role: string };
  resolver: { id: string; name: string; email: string } | null;
};

type EditorState = {
  branchId: string;
  permissions: PermissionKey[];
  password: string;
  employeeProfileId: string | null;
  employeeCode: string;
  title: string;
  department: string;
  baseSalary: string;
  allowance: string;
  transportAllowance: string;
  commissionType: string;
  commissionRate: string;
};

type EmployeeProfileRow = {
  id: string;
  employeeCode: string;
  title: string | null;
  department: string | null;
  branch: { id: string; name: string } | null;
  user: { id: string; name: string; email: string };
  currentCompensation: {
    baseSalary: number;
    allowance: number;
    transportAllowance: number;
  } | null;
  commissionRule: {
    type: string;
    rate: number;
  } | null;
};

function PermissionChecklist(props: {
  value: PermissionKey[];
  disabled?: boolean;
  onToggle: (permission: PermissionKey) => void;
}) {
  const selected = useMemo(() => new Set(props.value), [props.value]);

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm font-semibold">{group.label}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {group.permissions.map((permission) => {
              const checked = selected.has(permission.key);
              return (
                <label key={permission.key} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={props.disabled}
                    onChange={() => props.onToggle(permission.key)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{permission.label}</span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {permission.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TeamPage() {
  const { t, lang } = useLang();
  const tu = t.users;
  const { data: session } = useSession();
  const sessionPermissions = useMemo(
    () => normalizePermissions(session?.user?.permissions ?? []),
    [session?.user?.permissions],
  );
  const canSeeTeam = hasPermission(sessionPermissions, PERMISSIONS.usersRead);
  const canCreateUsers = hasPermission(sessionPermissions, PERMISSIONS.usersCreate);
  const canUpdateUsers = hasPermission(sessionPermissions, PERMISSIONS.usersUpdate);
  const canManagePermissions = hasPermission(sessionPermissions, PERMISSIONS.usersPermissionsManage);
  const canActivateUsers = hasPermission(sessionPermissions, PERMISSIONS.usersActivate);
  const canGenerateCode = hasPermission(sessionPermissions, PERMISSIONS.elevationCodeIssue);
  const canResolveApprovals = hasPermission(sessionPermissions, PERMISSIONS.elevationApprovalsResolve);
  const canManagePayroll = hasPermission(sessionPermissions, PERMISSIONS.payrollManage);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusLine, setStatusLine] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [employeeProfiles, setEmployeeProfiles] = useState<EmployeeProfileRow[]>([]);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newBranchId, setNewBranchId] = useState("");
  const [newPermissions, setNewPermissions] = useState<PermissionKey[]>([
    ...LEGACY_ROLE_PERMISSION_PRESETS.CASHIER,
  ]);
  const [creating, setCreating] = useState(false);

  const [codeDisplay, setCodeDisplay] = useState<{ code: string; expiresAt: string } | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    if (!canSeeTeam) return;
    setLoading(true);
    try {
      const [uRes, bRes, aRes, hrRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/branches"),
        fetch("/api/elevate/approvals"),
        fetch("/api/hr/employees"),
      ]);
      if (uRes.ok) {
        const data = await parseResponseJson<{ users: UserRow[] }>(uRes);
        setUsers(data?.users ?? []);
      }
      if (bRes.ok) {
        const data = await parseResponseJson<unknown>(bRes);
        setBranches(Array.isArray(data) ? (data as BranchOption[]) : []);
      }
      if (aRes.ok) {
        const data = await parseResponseJson<{ approvals: ApprovalRow[] }>(aRes);
        setApprovals(data?.approvals ?? []);
      } else {
        setApprovals([]);
      }
      if (hrRes.ok) {
        const data = await parseResponseJson<{ rows: EmployeeProfileRow[] }>(hrRes);
        setEmployeeProfiles(data?.rows ?? []);
      } else {
        setEmployeeProfiles([]);
      }
    } finally {
      setLoading(false);
    }
  }, [canSeeTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreateUsers || !canManagePermissions) return;
    setCreating(true);
    setStatusLine("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          permissions: newPermissions,
          branchId: newBranchId || null,
        }),
      });
      const data = await parseResponseJson<{ message?: string }>(res);
      if (!res.ok) {
        setStatusLine(errorMessageFromJson(data, t.errors.generic));
        return;
      }
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewBranchId("");
      setNewPermissions([...LEGACY_ROLE_PERMISSION_PRESETS.CASHIER]);
      setStatusLine(tu.addUser);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const patchUser = async (id: string, patch: Record<string, unknown>) => {
    setStatusLine("");
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatusLine(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatusLine(t.actions.save);
    await load();
  };

  const openEditor = (user: UserRow) => {
    const employee = employeeProfiles.find((row) => row.user.id === user.id) ?? null;
    setEditingUserId((current) => (current === user.id ? null : user.id));
    setEditor({
      branchId: user.branchId ?? "",
      permissions: normalizePermissions(user.permissions),
      password: "",
      employeeProfileId: employee?.id ?? null,
      employeeCode: employee?.employeeCode ?? `EMP-${user.id.slice(-4).toUpperCase()}`,
      title: employee?.title ?? "",
      department: employee?.department ?? "",
      baseSalary: employee?.currentCompensation ? String(employee.currentCompensation.baseSalary) : "",
      allowance: employee?.currentCompensation ? String(employee.currentCompensation.allowance) : "",
      transportAllowance: employee?.currentCompensation ? String(employee.currentCompensation.transportAllowance) : "",
      commissionType: employee?.commissionRule?.type ?? "PERCENT_OF_REVENUE",
      commissionRate: employee?.commissionRule ? String(employee.commissionRule.rate) : "",
    });
  };

  const toggleEditorPermission = (permission: PermissionKey) => {
    setEditor((current) => {
      if (!current) return current;
      const next = new Set(current.permissions);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...current, permissions: Array.from(next).sort((a, b) => a.localeCompare(b)) as PermissionKey[] };
    });
  };

  const toggleNewPermission = (permission: PermissionKey) => {
    setNewPermissions((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return Array.from(next).sort((a, b) => a.localeCompare(b)) as PermissionKey[];
    });
  };

  const applyPresetToCreate = (preset: AppRole) => {
    setNewPermissions([...LEGACY_ROLE_PERMISSION_PRESETS[preset]]);
  };

  const applyPresetToEditor = (preset: AppRole) => {
    setEditor((current) => (current ? { ...current, permissions: [...LEGACY_ROLE_PERMISSION_PRESETS[preset]] } : current));
  };

  const saveUserAccess = async (userId: string) => {
    if (!editor) return;
    setSavingEditor(true);
    try {
      const patch: Record<string, unknown> = {};
      if (canUpdateUsers) {
        patch.branchId = editor.branchId || null;
      }
      if (canManagePermissions) {
        patch.permissions = editor.permissions;
      }
      await patchUser(userId, patch);
    } finally {
      setSavingEditor(false);
    }
  };

  const saveUserPassword = async (userId: string) => {
    if (!editor?.password.trim() || editor.password.length < 8) {
      setStatusLine("Password must be at least 8 characters.");
      return;
    }
    setSavingPassword(true);
    try {
      await patchUser(userId, { password: editor.password });
      setEditor((current) => (current ? { ...current, password: "" } : current));
    } finally {
      setSavingPassword(false);
    }
  };

  const saveUserPayroll = async (user: UserRow) => {
    if (!editor || !canManagePayroll) return;
    setStatusLine("");
    const payload = {
      branchId: editor.branchId || null,
      employeeCode: editor.employeeCode,
      title: editor.title || undefined,
      department: editor.department || undefined,
      compensation: {
        baseSalary: Number(editor.baseSalary || 0),
        allowance: Number(editor.allowance || 0),
        transportAllowance: Number(editor.transportAllowance || 0),
      },
      commissionRule: editor.commissionRate
        ? {
            type: editor.commissionType as "PERCENT_OF_REVENUE" | "FIXED_PER_SALE" | "MARGIN_SHARE",
            rate: Number(editor.commissionRate),
          }
        : null,
    };
    const url = editor.employeeProfileId ? `/api/hr/employees/${editor.employeeProfileId}` : "/api/hr/employees";
    const method = editor.employeeProfileId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        editor.employeeProfileId
          ? payload
          : {
              ...payload,
              userId: user.id,
            },
      ),
    });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatusLine(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatusLine("Payroll profile saved.");
    await load();
  };

  const generateCode = async () => {
    if (!canGenerateCode) return;
    setGeneratingCode(true);
    setCodeDisplay(null);
    try {
      const res = await fetch("/api/elevate/code", { method: "POST" });
      const data = await parseResponseJson<{ code?: string; expiresAt?: string; message?: string }>(res);
      if (!res.ok) {
        setStatusLine(errorMessageFromJson(data, t.errors.generic));
        return;
      }
      if (data?.code && data.expiresAt) {
        setCodeDisplay({ code: data.code, expiresAt: data.expiresAt });
      }
    } finally {
      setGeneratingCode(false);
    }
  };

  const resolveApproval = async (id: string, approve: boolean) => {
    if (!canResolveApprovals) return;
    const res = await fetch(`/api/elevate/approvals/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve }),
    });
    if (!res.ok) {
      const data = await parseResponseJson<{ message?: string }>(res);
      setStatusLine(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    await load();
  };

  if (!canSeeTeam) {
    return (
      <AppPage>
        <PageHeader title={tu.title} subtitle={tu.subtitle} />
        <EmptyState title={t.errors.unauthorized} />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHeader title={tu.title} subtitle={tu.subtitle} />

      {statusLine ? (
        <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
          {statusLine}
        </p>
      ) : null}

      {canManagePayroll ? (
        <Card className="mb-6">
          <SectionTitle title="HR & payroll" subtitle="Compensation can be updated here or in the dedicated payroll workspace." />
          <Link href="/hr" className="app-btn app-btn-secondary inline-flex">
            Open HR workspace
          </Link>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle title={tu.elevationCode} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void generateCode()} disabled={generatingCode || !canGenerateCode}>
              {generatingCode ? tu.generating : tu.generateCode}
            </Button>
          </div>
          {codeDisplay ? (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-950">{tu.shareCodeHint}:</p>
              <p className="mt-2 font-mono text-3xl tracking-[0.35em] text-amber-950">{codeDisplay.code}</p>
              <p className="mt-2 text-xs text-amber-900">
                {tu.expires}{" "}
                {new Date(codeDisplay.expiresAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title={tu.pendingApprovals} />
          {loading ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t.actions.loading}
            </p>
          ) : !canResolveApprovals ? (
            <EmptyState title="You do not have approval permissions." />
          ) : approvals.filter((a) => a.status === "PENDING").length === 0 ? (
            <EmptyState title={t.empty.noData} />
          ) : (
            <ul className="space-y-3">
              {approvals
                .filter((a) => a.status === "PENDING")
                .map((a) => (
                  <li key={a.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                    <p className="font-medium">{a.summary}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {a.requester.name} ({a.requester.email}) · {a.routeHint ?? "—"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" className="text-sm" onClick={() => void resolveApproval(a.id, true)}>
                        {tu.approve}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="text-sm"
                        onClick={() => void resolveApproval(a.id, false)}
                      >
                        {tu.deny}
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <SectionTitle title={tu.staffAccounts} />
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t.actions.loading}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="py-2 pe-2 font-medium text-start">{tu.colName}</th>
                  <th className="py-2 pe-2 font-medium text-start">{tu.colEmail}</th>
                  <th className="py-2 pe-2 font-medium text-start">Permissions</th>
                  {canManagePayroll ? <th className="py-2 pe-2 font-medium text-start">Salary</th> : null}
                  <th className="py-2 pe-2 font-medium text-start">{tu.colBranch}</th>
                  <th className="py-2 pe-2 font-medium text-start">{tu.colStatus}</th>
                  {canManagePermissions || canUpdateUsers || canActivateUsers ? (
                    <th className="py-2 font-medium text-start">{tu.colActions}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isEditing = editingUserId === u.id && editor;
                  const employee = employeeProfiles.find((row) => row.user.id === u.id) ?? null;
                  return (
                    <Fragment key={u.id}>
                      <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2 pe-2">{u.name}</td>
                        <td className="py-2 pe-2">{u.email}</td>
                        <td className="py-2 pe-2">
                          <span className="text-sm">{describePermissionCount(normalizePermissions(u.permissions).length)}</span>
                        </td>
                        {canManagePayroll ? (
                          <td className="py-2 pe-2">
                            {employee?.currentCompensation ? `EGP ${employee.currentCompensation.baseSalary.toFixed(2)}` : "—"}
                          </td>
                        ) : null}
                        <td className="py-2 pe-2">{u.branch?.name ?? "—"}</td>
                        <td className="py-2 pe-2">
                          <StatusBadge tone={u.isActive ? "success" : "neutral"}>
                            {u.isActive ? t.status.active : t.status.inactive}
                          </StatusBadge>
                        </td>
                        {canManagePermissions || canUpdateUsers || canActivateUsers ? (
                          <td className="py-2">
                            <Button
                              type="button"
                              variant="secondary"
                              className="text-xs"
                              onClick={() => openEditor(u)}
                            >
                              {editingUserId === u.id ? "Close" : "Manage"}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                      {isEditing ? (
                        <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                          <td className="py-4" colSpan={canManagePermissions || canUpdateUsers || canActivateUsers ? (canManagePayroll ? 7 : 6) : (canManagePayroll ? 6 : 5)}>
                            <div className="space-y-4 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold">Manage access for {u.name}</p>
                                {canActivateUsers ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="text-xs"
                                    onClick={() => void patchUser(u.id, { isActive: !u.isActive })}
                                  >
                                    {u.isActive ? "Deactivate user" : "Activate user"}
                                  </Button>
                                ) : null}
                              </div>

                              {canUpdateUsers ? (
                                <label className="block text-sm">
                                  {t.labels.branch} ({t.labels.optional})
                                  <Select
                                    className="mt-1 w-full"
                                    value={editor.branchId}
                                    onChange={(e) => setEditor((current) => (current ? { ...current, branchId: e.target.value } : current))}
                                  >
                                    <option value="">—</option>
                                    {branches.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.name}
                                      </option>
                                    ))}
                                  </Select>
                                </label>
                              ) : null}

                              {canManagePermissions ? (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap gap-2">
                                    {(["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"] as AppRole[]).map((preset) => (
                                      <Button
                                        key={preset}
                                        type="button"
                                        variant="secondary"
                                        className="text-xs"
                                        onClick={() => applyPresetToEditor(preset)}
                                      >
                                        Apply {preset.toLowerCase()} preset
                                      </Button>
                                    ))}
                                  </div>
                                  <PermissionChecklist value={editor.permissions} onToggle={toggleEditorPermission} />
                                </div>
                              ) : null}

                              {canManagePayroll ? (
                                <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                                  <p className="text-sm font-semibold">Compensation & payroll profile</p>
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <label className="text-sm">
                                      Employee code
                                      <Input
                                        className="mt-1 w-full"
                                        value={editor.employeeCode}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, employeeCode: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Title
                                      <Input
                                        className="mt-1 w-full"
                                        value={editor.title}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, title: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Department
                                      <Input
                                        className="mt-1 w-full"
                                        value={editor.department}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, department: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Base salary
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="mt-1 w-full"
                                        value={editor.baseSalary}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, baseSalary: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Allowance
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="mt-1 w-full"
                                        value={editor.allowance}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, allowance: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Transport allowance
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="mt-1 w-full"
                                        value={editor.transportAllowance}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, transportAllowance: e.target.value } : current))}
                                      />
                                    </label>
                                    <label className="text-sm">
                                      Commission type
                                      <Select
                                        className="mt-1 w-full"
                                        value={editor.commissionType}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, commissionType: e.target.value } : current))}
                                      >
                                        <option value="PERCENT_OF_REVENUE">Percent of revenue</option>
                                        <option value="FIXED_PER_SALE">Fixed per sale</option>
                                        <option value="MARGIN_SHARE">Margin share</option>
                                      </Select>
                                    </label>
                                    <label className="text-sm">
                                      Commission rate
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="mt-1 w-full"
                                        value={editor.commissionRate}
                                        onChange={(e) => setEditor((current) => (current ? { ...current, commissionRate: e.target.value } : current))}
                                      />
                                    </label>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Button type="button" variant="secondary" onClick={() => void saveUserPayroll(u)}>
                                      Save payroll profile
                                    </Button>
                                  </div>
                                </div>
                              ) : null}

                              {canManagePermissions || canUpdateUsers ? (
                                <div className="flex flex-wrap gap-2">
                                  <Button type="button" disabled={savingEditor} onClick={() => void saveUserAccess(u.id)}>
                                    {savingEditor ? t.actions.saving : "Save access"}
                                  </Button>
                                </div>
                              ) : null}

                              {canUpdateUsers ? (
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                                  <label className="text-sm">
                                    Reset password
                                    <Input
                                      type="password"
                                      className="mt-1 w-full"
                                      value={editor.password}
                                      onChange={(e) =>
                                        setEditor((current) => (current ? { ...current, password: e.target.value } : current))
                                      }
                                      minLength={8}
                                      placeholder="New temporary password"
                                    />
                                  </label>
                                  <div className="flex items-end">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      disabled={savingPassword}
                                      onClick={() => void saveUserPassword(u.id)}
                                    >
                                      {savingPassword ? t.actions.saving : "Reset password"}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canCreateUsers && canManagePermissions ? (
        <Card className="mt-6">
          <SectionTitle title={tu.addUser} />
          <form onSubmit={createUser} className="grid max-w-xl grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm md:col-span-2">
              {t.labels.name}
              <Input className="mt-1 w-full" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </label>
            <label className="text-sm md:col-span-2">
              {t.labels.email}
              <Input
                type="email"
                className="mt-1 w-full"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </label>
            <label className="text-sm md:col-span-2">
              {t.labels.password}
              <Input
                type="password"
                className="mt-1 w-full"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <label className="text-sm">
              {t.labels.branch} ({t.labels.optional})
              <Select
                className="mt-1 w-full"
                value={newBranchId}
                onChange={(e) => setNewBranchId(e.target.value)}
              >
                <option value="">—</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="space-y-3 md:col-span-2">
              <div className="flex flex-wrap gap-2">
                {(["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"] as AppRole[]).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    onClick={() => applyPresetToCreate(preset)}
                  >
                    Apply {preset.toLowerCase()} preset
                  </Button>
                ))}
              </div>
              <PermissionChecklist value={newPermissions} onToggle={toggleNewPermission} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={creating}>
                {creating ? t.actions.saving : t.actions.create}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </AppPage>
  );
}
