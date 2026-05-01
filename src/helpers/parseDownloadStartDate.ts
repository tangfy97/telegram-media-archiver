const DATE_INPUT_PATTERN =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const parseDownloadStartDate = (input: string) => {
  const trimmedInput = input.trim();
  const match = trimmedInput.match(DATE_INPUT_PATTERN);

  if (!match) {
    throw new Error(
      'Invalid date format. Use YYYY-MM-DD, YYYY/MM/DD, or add HH:mm[:ss]'
    );
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] =
    match;

  const parsedDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  if (
    parsedDate.getFullYear() !== Number(year) ||
    parsedDate.getMonth() !== Number(month) - 1 ||
    parsedDate.getDate() !== Number(day) ||
    parsedDate.getHours() !== Number(hour) ||
    parsedDate.getMinutes() !== Number(minute) ||
    parsedDate.getSeconds() !== Number(second)
  ) {
    throw new Error('Invalid date value');
  }

  return parsedDate;
};

export default parseDownloadStartDate;
