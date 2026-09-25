import type { ConnectionService } from './connections';
import type { DevicePlugins } from './device-plugins';
import type { PinService } from './pins';
import type { PluginCatalog } from './plugin-catalog';
import type { ProfileService } from './profiles';
import type { SessionService } from './session';
import type { SourceService } from './sources';

/** The service graph screens resolve what they need from. Built by the composition root. */
export interface Services {
  readonly catalog: PluginCatalog;
  readonly devicePlugins: DevicePlugins;
  readonly session: SessionService;
  readonly profiles: ProfileService;
  readonly pins: PinService;
  readonly connections: ConnectionService;
  readonly sources: SourceService;
}
