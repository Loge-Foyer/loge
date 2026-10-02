import type { AudioStreamInfo, MediaVersion, SubtitleStreamInfo } from '@loge/api';
import { connectionId as asConnectionId } from '@loge/api';
import { useState } from 'react';
import { SizableText, Spinner, YStack } from 'tamagui';

import {
  bitrateName,
  channelName,
  fileSize,
  formatName,
  hdrName,
  languageName,
  resolutionName,
  spatialName,
} from '@/components/labels';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { SheetScreen } from '@/components/sheet';
import { SourceTabs } from '@/components/source-tabs';
import { useItem } from '@/hooks/use-media';

/**
 * What the file actually is: the picture, every audio track, every subtitle,
 * and what it weighs. Opened from the summary at the foot of a detail page.
 *
 * Everything here is inline: this is a native sheet, which a portal would
 * render behind.
 */
export function MediaInfoScreen({ connectionId, itemId }: { connectionId: string; itemId: string }) {
  const detail = useItem({ connectionId: asConnectionId(connectionId), externalId: itemId });
  const versions = detail.data?.detail.versions ?? [];
  const [chosen, setChosen] = useState(0);
  const version = versions[Math.min(chosen, versions.length - 1)];

  return (
    <SheetScreen title="Media details">
      {detail.isPending ? (
        <YStack py="$8" items="center">
          <Spinner size="large" color="$accent9" />
        </YStack>
      ) : !version ? (
        <SizableText color="$color10">This source does not say what the file is.</SizableText>
      ) : (
        <>
          {versions.length > 1 ? (
            <SourceTabs
              tabs={versions.map((candidate, index) => ({
                id: String(index),
                label: candidate.label ?? resolutionName(candidate.video?.height, candidate.video?.width) ?? `Version ${index + 1}`,
              }))}
              selected={String(Math.min(chosen, versions.length - 1))}
              onSelect={(id) => setChosen(Number(id))}
            />
          ) : null}
          <VersionDetails version={version} />
        </>
      )}
    </SheetScreen>
  );
}

function VersionDetails({ version }: { version: MediaVersion }) {
  const video = version.video;
  return (
    <>
      <SettingsSection title="File">
        <Fact label="Size" value={fileSize(version.sizeBytes)} />
        <Fact label="Container" value={version.container === undefined ? undefined : formatName(version.container)} />
        <Fact label="Bitrate" value={bitrateName(version.bitrate)} />
      </SettingsSection>

      {video ? (
        <SettingsSection title="Video">
          <Fact
            label="Resolution"
            value={
              resolutionName(video.height, video.width) === undefined
                ? undefined
                : `${resolutionName(video.height, video.width)}${video.width && video.height ? ` · ${video.width}×${video.height}` : ''}`
            }
          />
          <Fact label="Codec" value={video.codec === undefined ? undefined : formatName(video.codec)} />
          <Fact label="Profile" value={video.profile} />
          <Fact label="Dynamic range" value={video.hdr === undefined ? 'SDR' : hdrName(video.hdr)} />
          <Fact label="Bit depth" value={video.bitDepth === undefined ? undefined : `${video.bitDepth}-bit`} />
          <Fact
            label="Frame rate"
            value={video.frameRate === undefined ? undefined : `${Math.round(video.frameRate * 1000) / 1000} fps`}
          />
          <Fact label="Bitrate" value={bitrateName(video.bitrate)} />
        </SettingsSection>
      ) : null}

      {version.audio.length > 0 ? (
        <SettingsSection title={version.audio.length === 1 ? 'Audio' : `Audio · ${version.audio.length} tracks`}>
          {version.audio.map((track, index) => (
            <SettingsRow key={index} title={audioTitle(track, index)} subtitle={audioSubtitle(track)} />
          ))}
        </SettingsSection>
      ) : null}

      {version.subtitles.length > 0 ? (
        <SettingsSection
          title={version.subtitles.length === 1 ? 'Subtitles' : `Subtitles · ${version.subtitles.length} tracks`}
        >
          {version.subtitles.map((track, index) => (
            <SettingsRow key={index} title={subtitleTitle(track, index)} subtitle={subtitleSubtitle(track)} />
          ))}
        </SettingsSection>
      ) : null}
    </>
  );
}

function audioTitle(track: AudioStreamInfo, index: number): string {
  return languageName(track.language) ?? track.label ?? `Track ${index + 1}`;
}

function audioSubtitle(track: AudioStreamInfo): string {
  return [
    track.codec === undefined ? undefined : formatName(track.codec),
    channelName(track.channels, track.channelLayout),
    // Named rather than inferred: Atmos rides inside more than one codec.
    track.spatial === undefined ? undefined : spatialName(track.spatial),
    bitrateName(track.bitrate),
    track.default ? 'Default' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function subtitleTitle(track: SubtitleStreamInfo, index: number): string {
  return languageName(track.language) ?? track.label ?? `Track ${index + 1}`;
}

function subtitleSubtitle(track: SubtitleStreamInfo): string {
  return [
    track.format === undefined ? undefined : formatName(track.format),
    track.forced ? 'Forced' : undefined,
    track.delivery === 'external' ? 'Separate file' : track.delivery === 'burned' ? 'Burned in' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One fact, left and right. Absent values do not make a row at all. */
function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (value === undefined) return null;
  return (
    <SettingsRow
      title={label}
      trailing={
        <SizableText size="$3" color="$color11">
          {value}
        </SizableText>
      }
    />
  );
}
