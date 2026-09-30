// Only allow safe flag characters — blocks shell metacharacters like ; | & ` $() etc.
export const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/]*$/;

export function validateFlags(flags: string[]): string | null {
  for (const flag of flags) {
    if (!FLAG_PATTERN.test(flag.trim())) {
      return `Invalid flag: "${flag}". Flags must start with - or -- and contain only safe characters.`;
    }
  }
  return null;
}
