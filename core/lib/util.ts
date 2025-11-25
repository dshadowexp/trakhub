export function getTimezone(date: Date) {
    const offset = -date.getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;
    const sign = offset >= 0 ? '+' : '-';
    return `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
}

export function formatGitDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const timezone = getTimezone(date);
    
    // Get date parts in UTC
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[date.getUTCDay()];
    const monthName = months[date.getUTCMonth()];
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    
    return `${dayName} ${monthName} ${day} ${hours}:${minutes}:${seconds} ${year} ${timezone}`;
}