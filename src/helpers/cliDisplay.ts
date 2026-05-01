const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const color = (code: number, value: string) =>
  useColor ? `\x1b[${code}m${value}\x1b[0m` : value;

const cyan = (value: string) => color(36, value);
const green = (value: string) => color(32, value);
const yellow = (value: string) => color(33, value);
const red = (value: string) => color(31, value);
const dim = (value: string) => color(2, value);
const bold = (value: string) => color(1, value);

const divider = () => dim('------------------------------------------------------------');

export const shortenMiddle = (value: string, maxLength = 64) => {
  if (value.length <= maxLength) return value;

  const keep = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, keep)}...${value.slice(value.length - keep)}`;
};

const cliDisplay = {
  banner() {
    console.log('');
    console.log(bold(cyan('telegram-bulk-downloader')));
    console.log(dim('Bulk download Telegram media with date and thread support.'));
    console.log(divider());
  },

  section(title: string) {
    console.log('');
    console.log(bold(cyan(title)));
  },

  info(message: string) {
    console.log(`${cyan('[info]')} ${message}`);
  },

  success(message: string) {
    console.log(`${green('[done]')} ${message}`);
  },

  warn(message: string) {
    console.warn(`${yellow('[warn]')} ${message}`);
  },

  error(message: string) {
    console.error(`${red('[error]')} ${message}`);
  },

  summary(items: [string, string | number | boolean | undefined][]) {
    for (const [label, value] of items) {
      console.log(`${dim(label.padEnd(18))} ${value ?? 'not set'}`);
    }
  },
};

export default cliDisplay;
