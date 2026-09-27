import type { AccountService } from './account';
import type { ConnectionService } from './connections';
import type { DevicePlugins } from './device-plugins';
import type { HomeLayoutService } from './home-layout';
import type { MediaService } from './media';
import type { OwnerCheck } from './owner-check';
import type { PinService } from './pins';
import type { PluginCatalog } from './plugin-catalog';
import type { ProfileService } from './profiles';
import type { SessionService } from './session';
import type { SourceService } from './sources';
import type { Applied } from './sync/apply';
import type { SyncStatus } from './sync/engine';

/** The sync engine as screens see it: how it stands, what it brought, and "Sync now". */
export interface SyncService {
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
  onApplied(listener: (applied: Applied) => void): () => void;
  now(): Promise<void>;
}

/** The service graph screens resolve what they need from. Built by the composition root. */
export interface Services {
  readonly catalog: PluginCatalog;
  readonly devicePlugins: DevicePlugins;
  readonly session: SessionService;
  readonly profiles: ProfileService;
  readonly pins: PinService;
  readonly connections: ConnectionService;
  readonly sources: SourceService;
  readonly homeLayout: HomeLayoutService;
  readonly media: MediaService;
  readonly account: AccountService;
  readonly owner: OwnerCheck;
  readonly sync: SyncService;
}
