export function toPublicUser(row, roles) {
  const uniqueRoles = [...new Set(roles.filter(Boolean))];
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    accountStatus: row.account_status,
    emailVerified: Boolean(row.email_verified_at),
    role: uniqueRoles.includes('admin') ? 'admin' : (uniqueRoles[0] || 'user'),
    roles: uniqueRoles,
  };
}

export function developmentOnly(fields) {
  const entries = Object.entries(fields).filter(([, value]) => value);
  if (entries.length === 0) return {};
  return { developmentOnly: Object.fromEntries(entries) };
}
