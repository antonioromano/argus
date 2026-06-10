const MIN_LENGTH = 12;

// Small blocklist of trivially common passwords that meet the length requirement.
const COMMON = new Set([
  'password123456', 'qwertyuiop123', '123456789012', 'iloveyou1234',
  'welcome12345', 'admin123456789', 'letmein123456', 'monkey123456',
]);

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (COMMON.has(password.toLowerCase())) {
    return 'Password is too common. Choose a more unique password.';
  }
  return null;
}
