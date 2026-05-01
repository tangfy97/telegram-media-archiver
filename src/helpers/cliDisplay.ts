const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const color = (code: number, value: string) =>
  useColor ? `\x1b[${code}m${value}\x1b[0m` : value;

const cyan = (value: string) => color(36, value);
const green = (value: string) => color(32, value);
const yellow = (value: string) => color(33, value);
const red = (value: string) => color(31, value);
const dim = (value: string) => color(2, value);
const bold = (value: string) => color(1, value);

const terminalWidth = () => Math.min(process.stdout.columns || 88, 92);
const divider = () => dim('-'.repeat(terminalWidth()));

export const shortenMiddle = (value: string, maxLength = 64) => {
  if (value.length <= maxLength) return value;

  const keep = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, keep)}...${value.slice(value.length - keep)}`;
};

const formatValue = (value: string | number | boolean | undefined) =>
  value === undefined ? 'not set' : String(value);

const panelBorder = (title?: string) => {
  const width = terminalWidth() - 2;
  if (!title) return `+${'-'.repeat(width)}+`;

  const label = ` ${title} `;
  const remaining = Math.max(0, width - label.length);
  return `+${label}${'-'.repeat(remaining)}+`;
};

const cliDisplay = {
  banner() {
    const width = terminalWidth() - 4;
    const title = 'telegram-bulk-downloader';
    const subtitle = 'Archive Telegram media by date, type, album, and thread';

    console.log('');
    console.log(dim(panelBorder()));
    console.log(
      `${dim('|')} ${bold(cyan(title))}${' '.repeat(
        Math.max(0, width - title.length)
      )} ${dim('|')}`
    );
    console.log(
      `${dim('|')} ${dim(subtitle)}${' '.repeat(
        Math.max(0, width - subtitle.length)
      )} ${dim('|')}`
    );
    console.log(dim(panelBorder()));
  },

  section(title: string) {
    console.log('');
    console.log(bold(cyan(title)));
    console.log(divider());
  },

  step(index: number, total: number, title: string) {
    console.log('');
    console.log(`${cyan(`Step ${index}/${total}`)} ${bold(title)}`);
  },

  flow(items: string[], activeIndex?: number) {
    const renderedItems = items.map((item, index) => {
      const token = `[${index + 1}] ${item}`;
      return index === activeIndex ? bold(cyan(token)) : dim(token);
    });

    console.log(renderedItems.join(dim('  ->  ')));
  },

  panel(
    title: string,
    items: [string, string | number | boolean | undefined][]
  ) {
    const width = terminalWidth();
    const innerWidth = width - 4;
    const labelWidth = Math.min(
      Math.max(...items.map(([label]) => label.length), 10),
      18
    );
    const valueWidth = innerWidth - labelWidth - 3;

    console.log('');
    console.log(dim(panelBorder(title)));

    for (const [label, value] of items) {
      const displayValue = shortenMiddle(formatValue(value), valueWidth);
      const line = `${label.padEnd(labelWidth)} : ${displayValue}`;
      console.log(`${dim('|')} ${line.padEnd(innerWidth)} ${dim('|')}`);
    }

    console.log(dim(panelBorder()));
  },

  info(message: string) {
    console.log(`${cyan('[i]')} ${message}`);
  },

  action(message: string) {
    console.log(`${cyan('>')} ${message}`);
  },

  hint(message: string) {
    console.log(dim(message));
  },

  success(message: string) {
    console.log(`${green('[ok]')} ${message}`);
  },

  warn(message: string) {
    console.warn(`${yellow('[!]')} ${message}`);
  },

  error(message: string) {
    console.error(`${red('[x]')} ${message}`);
  },

  summary(items: [string, string | number | boolean | undefined][]) {
    for (const [label, value] of items) {
      console.log(`${dim(label.padEnd(18))} ${formatValue(value)}`);
    }
  },
};

export default cliDisplay;
