import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string, locale = 'en-US'): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatTime(date: Date | string): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

export function formatDateTime(date: Date | string): string {
  if (!date) return '';
  return `${formatDate(date)} at ${formatTime(date)}`;
}

export const statusColors = {
  success: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-neutral-200 text-neutral-700',
};

export function getStatusClass(status: string): string {
  const statusMap: Record<string, string> = {
    active: statusColors.success,
    inactive: statusColors.neutral,
    pending: statusColors.warning,
    approved: statusColors.success,
    rejected: statusColors.error,
    cancelled: statusColors.neutral,
    valid: statusColors.success,
    expiring_soon: statusColors.warning,
    expired: statusColors.error,
    present: statusColors.success,
    absent: statusColors.error,
    late: statusColors.warning,
    on_leave: statusColors.info,
    processed: statusColors.success,
    failed: statusColors.error,
    upcoming: statusColors.info,
    ongoing: statusColors.warning,
    completed: statusColors.success,
    assigned: statusColors.info,
    confirmed: statusColors.warning,
    no_show: statusColors.error,
  };

  return statusMap[status.toLowerCase()] || statusColors.neutral;
}

export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function formatStatusText(status: string): string {
  if (!status) return '';
  return status.split('_').map(capitalize).join(' ');
}
