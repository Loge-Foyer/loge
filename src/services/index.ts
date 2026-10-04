import type { AccountService } from './account';
import type { BackupService } from './backup';
import type { BackupTargets } from './backup/targets';
import type { ConnectionService } from './connections';
import type { HomeLayoutService } from './home-layout';
import type { IdentityService } from './identity';
import type { MediaService } from './media';
import type { OwnerCheck } from './owner-check';
import type { PinService } from './pins';
import type { PlaybackService } from './playback';
import type { AccountSettingsService } from './account-settings';
import type { AppSettingsService } from './app-settings';
import type { PlayerService } from './players';
import type { FileExchange, PictureInPicture, ScreenBrightness, ScreenOrientationControl, SystemVolume, TvMenu } from './ports';
import type { PluginCatalog } from './plugin-catalog';
import type { ProfileService } from './profiles';
import type { SessionService } from './session';
import type { SourceService } from './sources';
import type { Applied } from './sync/parts';
import type { SyncStatus } from './sync/engine';
import type { DownloadService } from './downloads';
import type { ListsService } from './lists';
import type { LiveGroupService } from './live-groups';
import type { DownloadSettingsService } from './downloads/settings';
import type { WatchService } from './watch';

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
  readonly backup: BackupService;
  /** The account's backup file, kept on this device's backup targets as it changes. */
  readonly backupTargets: BackupTargets;
  /** Files the user moves in and out: a backup exported or imported. */
  readonly files: FileExchange;
  /** This device's players: which are on, and which plays first. */
  readonly players: PlayerService;
  /** What the app does by itself on this device — how the player turns, for now. */
  readonly appSettings: AppSettingsService;
  /** The account's own settings — which tabs it keeps watch status on — the same for every profile and device. */
  readonly accountSettings: AccountSettingsService;
  /** The screen's brightness, for the player's edge slider. */
  readonly brightness: ScreenBrightness;
  /** The device's media volume, for the other edge slider: the one its buttons move. */
  readonly volume: SystemVolume;
  /** Picture in picture where the platform gives it, rather than an engine. */
  readonly pictureInPicture: PictureInPicture;
  /** An Apple TV remote's Menu, kept for the player while its layers close one by one. */
  readonly tvMenu: TvMenu;
  /** Watch status for sources that master it: written here first, carried to them by the outbox. */
  readonly watch: WatchService;
  /** What a title is, from a metadata connection — so watch status the app keeps covers every copy of a film. */
  readonly identity: IdentityService;
  /** Copies kept on this device, and the budget they live within. */
  readonly downloads: DownloadService;
  readonly downloadSettings: DownloadSettingsService;
  /** The channels a profile follows and the lists it made — account-wide. */
  readonly lists: ListsService;
  /** The Live group each profile chose last on each provider — this device's. */
  readonly liveGroups: LiveGroupService;
  /** Pressing Play: which player plays what, its controller and its view. */
  readonly playback: PlaybackService;
  readonly orientation: ScreenOrientationControl;
}
