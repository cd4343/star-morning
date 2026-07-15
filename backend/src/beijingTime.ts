const BEIJING_OFFSET_MINUTES = 8 * 60;

export const getBeijingDate = (date: Date = new Date()): Date => {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60_000);
  return new Date(utc + (BEIJING_OFFSET_MINUTES * 60_000));
};

export const getLocalDateString = (date: Date = new Date()): string => {
  const beijingDate = getBeijingDate(date);
  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getBeijingTimeString = (date: Date = new Date()): string => {
  const beijingDate = getBeijingDate(date);
  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');
  const seconds = String(beijingDate.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
