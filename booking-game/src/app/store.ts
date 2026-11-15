// Client copy of the consult. Changes apply locally at once and are saved to
// the server shortly after; flush() waits until everything is saved.
import { api, ApiError, type Consult } from './api';
import { toast } from '../ui/dom';

type Patch = Partial<Pick<Consult, 'gender' | 'regions' | 'theme' | 'idea' | 'step'>> & { budget?: { amount: number } | null };

export class Store {
  consult: Consult | null = null;
  private pending: Patch = {};
  private timer = 0;
  private saving: Promise<void> = Promise.resolve();

  async refresh() {
    const { consult } = await api.me();
    this.consult = consult;
    return consult;
  }

  adopt(consult: Consult | null) {
    this.consult = consult;
    this.pending = {};
  }

  get editable() {
    return this.consult?.status === 'draft';
  }

  set(patch: Patch) {
    if (!this.consult || !this.editable) return;
    Object.assign(this.pending, patch);
    const { budget, ...rest } = patch;
    Object.assign(this.consult, rest);
    if (budget !== undefined) this.consult.budget = budget ? { amount: budget.amount, currency: this.consult.budget?.currency ?? 'NZD' } : null;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 450);
  }

  /** Saves anything still pending. Rejects with a readable message if the server refuses. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    const patch = this.pending;
    this.pending = {};
    if (!Object.keys(patch).length) return this.saving;
    this.saving = this.saving.then(async () => {
      try {
        const { consult } = await api.patch(patch);
        // Keep local edits made while this request was in flight.
        const local = this.pending;
        this.consult = consult;
        const { budget, ...rest } = local;
        Object.assign(this.consult, rest);
        if (budget !== undefined && budget) this.consult.budget = { amount: budget.amount, currency: consult.budget?.currency ?? 'NZD' };
      } catch (err) {
        // Put the patch back so the next flush retries it.
        this.pending = { ...patch, ...this.pending };
        const msg = err instanceof ApiError ? err.message : 'Could not save';
        toast(msg, true);
        throw err;
      }
    });
    return this.saving;
  }
}
