export function formatPhoneNumber(phoneStr: string | undefined | null): string {
    if (!phoneStr) return '';
    // Strip spaces, dashes, and parentheses
    return String(phoneStr).replace(/[\s\-()]/g, '').trim();
}

export function isValidPhoneNumber(phoneStr: string | undefined | null): boolean {
    if (!phoneStr) return false;
    const cleanPhone = formatPhoneNumber(phoneStr);
    return /^\+?[1-9]\d{9,14}$/.test(cleanPhone);
}
