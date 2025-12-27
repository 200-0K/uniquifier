const cliProgress = require('cli-progress');
const chalk = require('chalk');

function ellipsizeMiddle(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  const left = Math.floor((max - 1) / 2);
  const right = max - 1 - left;
  return str.slice(0, left) + '…' + str.slice(str.length - right);
}

function ellipsizeStart(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return '…' + str.slice(str.length - (max - 1));
}

class ProgressManager {
  constructor(concurrency = 5, overallTotal = 1, opts = {}) {
    this.concurrency = concurrency;
    this.stream = opts.stream || process.stderr;

    this.MAX_NAME = opts.maxName ?? 38;
    this.MAX_FILE = opts.maxFile ?? 46;

    this.errorCount = 0;

    this.multi = new cliProgress.MultiBar(
      {
        stream: this.stream,
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
        synchronousUpdate: true,
        fps: 12,
        barsize: 22,
        format: `${chalk.cyan('{bar}')} ${chalk.bold('{name}')} {value}/{total} ${chalk.dim('{filename}')}`,
      },
      cliProgress.Presets.shades_classic
    );

    // Worker lines FIRST (stay on top)
    this.slots = Array.from({ length: concurrency }, (_, i) => {
      const bar = this.multi.create(1, 0, {
        name: chalk.gray(`Idle ${i + 1}`),
        filename: '',
      });
      return { busy: false, bar };
    });

    // Overall LAST (stays at bottom)
    this.overall = this.multi.create(overallTotal, 0, {
      name: chalk.magenta(this._overallLabel()),
      filename: '',
    });
  }

  _overallLabel() {
    return this.errorCount > 0 ? `Overall (E:${this.errorCount})` : 'Overall';
  }

  addError(n = 1) {
    this.errorCount += n;
    try {
      this.overall.update(this.overall.value, { name: chalk.magenta(this._overallLabel()) });
    } catch (_) { }
  }

  acquireBar(name, total) {
    const slotIndex = this.slots.findIndex(s => !s.busy);
    const idx = slotIndex === -1 ? 0 : slotIndex;
    const slot = this.slots[idx];

    slot.busy = true;

    const safeName = ellipsizeMiddle(name, this.MAX_NAME);
    try {
      slot.bar.setTotal(Math.max(1, total || 1));
      slot.bar.update(0, { name: chalk.green(safeName), filename: '' });
    } catch (_) { }

    return { idx };
  }

  updateBar(handle, increment = 1, filename = '') {
    const slot = this.slots[handle.idx];
    if (!slot) return;

    const safeFile = ellipsizeStart(filename, this.MAX_FILE);
    try {
      slot.bar.increment(increment, { filename: safeFile ? chalk.cyan(safeFile) : '' });
    } catch (_) { }
  }

  releaseBar(handle) {
    const slot = this.slots[handle.idx];
    if (!slot) return;

    // Reset the worker line back to a clean Idle state (prevents Idle 5/5 etc)
    try {
      slot.bar.setTotal(1);
      slot.bar.update(0, { name: chalk.gray(`Idle ${handle.idx + 1}`), filename: '' });
    } catch (_) { }

    slot.busy = false;

    try {
      this.overall.increment();
      // keep name updated (in case errors changed)
      this.overall.update(this.overall.value, { name: chalk.magenta(this._overallLabel()) });
    } catch (_) { }
  }

  log(msg) {
    try {
      this.multi.log(msg);
    } catch (_) {
      console.log(msg);
    }
  }

  stop() {
    try {
      this.multi.stop();
    } catch (_) { }
  }
}

module.exports = ProgressManager;
