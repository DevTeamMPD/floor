// Shared helpers for the warehouse "username + 6-digit PIN" login flow.
//
// The fake email domain used here MUST stay inside the allow-list enforced
// by the `enforce_mpd_email_domain` trigger on `auth.users` (only
// `@mpdgroup.co` and `@staff.mpdgroup.internal` are accepted). The previous
// domain, `pin.floor.local`, was rejected by that trigger on every insert,
// which is why warehouse PIN account creation always failed with
// "Database error creating new user" and never actually created a user.
export const PIN_EMAIL_DOMAIN = "staff.mpdgroup.internal";

export function pinLoginEmail(username: string) {
  return `${username.trim().toLowerCase()}@${PIN_EMAIL_DOMAIN}`;
}
