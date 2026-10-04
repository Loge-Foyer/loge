import { describe, expect, it } from 'vitest';

import { createAccountSettingsService, watchStatusOf, WATCH_STATUS_DEFAULTS } from '@/services/account-settings';

import { ENGINES, openTestDatabase } from './support/engines';
import { fakeClock } from './support/fakes';

describe('watch status on the account', () => {
  it('reads Live from the record’s first name, `tv`, which older apps and every backup write', () => {
    expect(watchStatusOf({ media: true, videos: false, tv: false })).toEqual({ media: true, videos: false, live: false });
    // A tab the record does not say is the default, and so is anything that is not a switch.
    expect(watchStatusOf({ live: false, videos: 'yes' })).toEqual(WATCH_STATUS_DEFAULTS);
    expect(watchStatusOf(undefined)).toEqual(WATCH_STATUS_DEFAULTS);
  });

  it.each(ENGINES)('writes Live under `tv` on %s, so the account’s record keeps its shape', async (engine) => {
    const db = openTestDatabase(engine, { clock: fakeClock() });
    const settings = createAccountSettingsService({ db });
    await settings.setWatchStatus({ live: false });
    expect((await db.accountSettings.get('watchStatus'))?.value).toEqual({ media: false, videos: true, tv: false });
    expect(await settings.watchStatus()).toEqual({ media: false, videos: true, live: false });
  });
});
