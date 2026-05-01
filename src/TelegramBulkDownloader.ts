import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import fs from 'fs';
import os from 'os';
import path from 'path';
import inquirer from 'inquirer';
import Byteroo, { Container } from 'byteroo';
import { Entity } from 'telegram/define';
import { Logger } from 'telegram/extensions';
import extractDisplayName from './helpers/extractDisplayName';
import ask from './helpers/ask';
import buildDownloadFilename from './helpers/buildDownloadFilename';
import cliDisplay, { shortenMiddle } from './helpers/cliDisplay';
import JsonSerializer from './helpers/JsonSerializer';
import checkbox from '@inquirer/checkbox';
import getInputFilter from './helpers/getInputFilter';
import messageMatchesMediaType from './helpers/messageMatchesMediaType';
import parseDownloadStartDate from './helpers/parseDownloadStartDate';
import MediaType from './types/MediaType';
import { LogLevel } from 'telegram/extensions/Logger';
import cliProgress from 'cli-progress';

type DownloadMediaTypeState = {
  type: MediaType;
  offset: number;
};

type DownloadState = {
  displayName?: string;
  entityJson: any;
  outPath: string;
  metadata: boolean;
  mediaTypes: DownloadMediaTypeState[];
  selectedMediaTypes?: MediaType[];
  originalId: string;
  includeReplies?: boolean;
  limit?: number;
  replyOffset?: number;
  startDate?: string;
  startOffset?: number;
};

type DownloadStats = {
  downloaded: number;
  failed: number;
  scanned: number;
  replyThreads: number;
  startedAt: number;
};

class TelegramBulkDownloader {
  private storage: Byteroo;
  private credentials: Container;
  private state: Container;
  isDownloading: boolean;
  private SIGINT: boolean;
  private client?: TelegramClient;
  private stats: DownloadStats;
  constructor() {
    this.storage = new Byteroo({
      name: 'TelegramBulkDownloader',
      autocommit: true,
    });
    this.credentials = this.storage.getContainerSync(
      'credentials'
    ) as Container;
    this.state = this.storage.getContainerSync('state') as Container;
    this.isDownloading = false;
    this.SIGINT = false;
    this.stats = this.createStats();
  }

  private createStats(): DownloadStats {
    return {
      downloaded: 0,
      failed: 0,
      scanned: 0,
      replyThreads: 0,
      startedAt: Date.now(),
    };
  }

  private getDownloadState(id: string) {
    return this.state.get(id) as DownloadState;
  }

  private getSelectedMediaTypes(id: string) {
    const downloadState = this.getDownloadState(id);

    return (
      downloadState.selectedMediaTypes ||
      downloadState.mediaTypes.map((entry) => entry.type)
    );
  }

  private getDownloadStartTimestamp(id: string) {
    const startDate = this.getDownloadState(id).startDate;
    return startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : undefined;
  }

  private async resolveStartOffset(entity: Entity, id: string) {
    if (!this.client) throw new Error('TelegramClient undefined');

    const downloadState = this.getDownloadState(id);
    if (!downloadState.startDate) return 0;
    if (typeof downloadState.startOffset === 'number') {
      return downloadState.startOffset;
    }

    const startTimestamp = this.getDownloadStartTimestamp(id);
    if (!startTimestamp) return 0;

    const firstMessages = await this.client.getMessages(entity, {
      limit: 1,
      offsetDate: Math.max(0, startTimestamp - 1),
      reverse: true,
    });
    const latestMessage = await this.client.getMessages(entity, { limit: 1 });
    const startOffset =
      firstMessages.length > 0
        ? Math.max(0, firstMessages[0].id - 1)
        : latestMessage[0]?.id || 0;

    this.state.set(id, {
      ...this.getDownloadState(id),
      startOffset,
    });

    return startOffset;
  }

  private mediaTypeLabel(mediaType: MediaType) {
    switch (mediaType) {
      case 'InputMessagesFilterPhotos':
        return 'Photos';
      case 'InputMessagesFilterVideo':
        return 'Videos';
      case 'InputMessagesFilterDocument':
        return 'Documents';
      case 'InputMessagesFilterMusic':
        return 'Music';
      case 'InputMessagesFilterVoice':
        return 'Voice messages';
      case 'InputMessagesFilterGif':
        return 'GIFs';
      default:
        return mediaType;
    }
  }

  private formatStartDate(id: string) {
    const startDate = this.getDownloadState(id).startDate;
    if (!startDate) return 'from beginning';

    return new Date(startDate).toLocaleString();
  }

  private formatStateStartDate(downloadState: DownloadState) {
    if (!downloadState.startDate) return 'from beginning';

    return new Date(downloadState.startDate).toLocaleString();
  }

  private formatDuration(milliseconds: number) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes <= 0) return `${remainingSeconds}s`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private resolveOutputPath(input: string) {
    const trimmedInput = input.trim();

    if (trimmedInput === '~') return os.homedir();
    if (trimmedInput.startsWith('~/')) {
      return path.join(os.homedir(), trimmedInput.slice(2));
    }

    return path.resolve(trimmedInput);
  }

  private summarizeState(downloadState: DownloadState) {
    const mediaTypes = this.getStateSelectedMediaTypes(downloadState);

    return [
      ['Chat', downloadState.displayName || downloadState.originalId],
      ['Output', downloadState.outPath],
      ['Date range', this.formatStateStartDate(downloadState)],
      ['Media', mediaTypes.map((item) => this.mediaTypeLabel(item)).join(', ')],
      ['Reply threads', downloadState.includeReplies ? 'yes' : 'no'],
      ['Metadata', downloadState.metadata ? 'yes' : 'no'],
    ] as [string, string][];
  }

  private getStateSelectedMediaTypes(downloadState: DownloadState) {
    return (
      downloadState.selectedMediaTypes ||
      downloadState.mediaTypes.map((entry) => entry.type)
    );
  }

  private formatResumeChoice(id: string) {
    const downloadState = this.getDownloadState(id);
    const mediaTypes = downloadState.mediaTypes
      .map((entry) => this.mediaTypeLabel(entry.type))
      .join(', ');
    const remainingMedia = mediaTypes || 'reply threads / finalizing';

    return `${downloadState.displayName || id} | ${this.formatStateStartDate(
      downloadState
    )} | ${remainingMedia} | ${shortenMiddle(downloadState.outPath, 36)}`;
  }

  private markMediaTypeDone(id: string, mediaType: MediaType) {
    this.state.set(id, {
      ...this.getDownloadState(id),
      mediaTypes: this.getDownloadState(id).mediaTypes.filter(
        (entry) => entry.type !== mediaType
      ),
    });
  }

  private ensureDownloadDir(downloadDir: string) {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
  }

  private async downloadMessage(
    msg: Api.Message,
    downloadDir: string,
    fileName?: string
  ) {
    if (!this.client) throw new Error('TelegramClient undefined');
    const targetFileName = fileName || buildDownloadFilename(msg);
    const bar = new cliProgress.SingleBar(
      {
        clearOnComplete: true,
        hideCursor: true,
        format: `  {file}  |{bar}| {percentage}%  ETA {eta}s`,
      },
      {
        ...cliProgress.Presets.shades_classic,
        barCompleteChar: '#',
        barIncompleteChar: '-',
      }
    );

    bar.start(100, 0, {
      file: shortenMiddle(targetFileName, 70),
    });

    try {
      const buffer = await this.client.downloadMedia(msg, {
        progressCallback: (downloaded, total) => {
          if (this.SIGINT) {
            throw new Error(`Aborting download, SIGINT=true`);
          }

          const ratio = Number(downloaded) / Number(total);
          const progress = Math.round(Number(ratio) * 100);
          bar.update(progress);
        },
      });

      bar.update(100);
      fs.writeFileSync(path.join(downloadDir, targetFileName), buffer as any);
    } finally {
      bar.stop();
    }
  }

  private async exitOnInterrupt() {
    if (!this.client) throw new Error('TelegramClient undefined');
    cliDisplay.warn('Download interrupted. Saving progress before exit.');
    await this.client.disconnect();
    await this.client.destroy();
    await this.state.commit();
    process.exit(0);
  }

  private async downloadRepliesForMessage(
    entity: Entity,
    rootMessage: Api.Message,
    jsonSerializer?: JsonSerializer
  ) {
    if (!this.client) throw new Error('TelegramClient undefined');

    const id = entity.id.toString();
    const selectedMediaTypes = this.getSelectedMediaTypes(id);
    const downloadDir = this.getDownloadState(id).outPath;
    const startTimestamp = this.getDownloadStartTimestamp(id);
    let offset = 0;

    while (true) {
      const messages = await this.client.getMessages(entity, {
        limit: 100,
        offsetId: offset,
        reverse: true,
        replyTo: rootMessage.id,
      });

      if (messages.length === 0) {
        break;
      }

      this.stats.scanned += messages.length;
      let lastReplyId = 0;
      for (const replyMessage of messages) {
        lastReplyId = replyMessage.id;

        if (startTimestamp && replyMessage.date < startTimestamp) {
          continue;
        }

        if (jsonSerializer) {
          await jsonSerializer.append(replyMessage);
        }

        if (
          selectedMediaTypes.some((mediaType) =>
            messageMatchesMediaType(replyMessage, mediaType)
          )
        ) {
          try {
            await this.downloadMessage(
              replyMessage,
              downloadDir,
              buildDownloadFilename(replyMessage, {
                threadRootId: rootMessage.id,
              })
            );
            this.stats.downloaded += 1;
          } catch (err: any) {
            this.stats.failed += 1;
            cliDisplay.warn(
              `Failed to download reply ${replyMessage.id}: ${String(
                err?.message || err
              )}`
            );
          }
        }

        if (this.SIGINT) {
          break;
        }
      }

      offset = lastReplyId;

      if (this.SIGINT || lastReplyId <= 0 || messages.length < 100) {
        break;
      }
    }
  }

  private async downloadReplyThreads(entity: Entity) {
    if (!this.client) throw new Error('TelegramClient undefined');

    const id = entity.id.toString();
    const downloadState = this.getDownloadState(id);
    const downloadDir = downloadState.outPath;
    const startOffset = await this.resolveStartOffset(entity, id);
    const latestMessageId = this.getDownloadState(id).limit || 0;

    this.ensureDownloadDir(downloadDir);

    let jsonSerializer;
    if (downloadState.metadata) {
      jsonSerializer = new JsonSerializer(
        path.join(downloadDir, 'metadata.json')
      );
    }

    cliDisplay.section('Reply threads');
    cliDisplay.info(
      'Scanning messages with comments or reply threads. Large chats can take a while.'
    );

    if (downloadState.startDate && startOffset >= latestMessageId) {
      cliDisplay.info('No messages found after the selected start date.');
      return;
    }

    while (true) {
      const offset = this.getDownloadState(id).replyOffset || startOffset;
      const messages = await this.client.getMessages(entity, {
        limit: 100,
        offsetId: offset,
        reverse: true,
      });

      if (messages.length === 0) {
        break;
      }

      let lastMessageId = offset;
      for (const msg of messages) {
        lastMessageId = msg.id;

        if (msg.replies) {
          this.stats.replyThreads += 1;
          try {
            await this.downloadRepliesForMessage(entity, msg, jsonSerializer);
          } catch (err: any) {
            if (
              err?.errorMessage === 'PEER_ID_INVALID' ||
              String(err?.message || err).includes('PEER_ID_INVALID')
            ) {
              cliDisplay.warn(
                'Comments/reply thread downloads are not available for this chat type.'
              );
              return;
            }

            cliDisplay.warn(
              `Failed to download replies for message ${msg.id}: ${String(
                err?.message || err
              )}`
            );
          }
        }

        this.state.set(id, {
          ...this.getDownloadState(id),
          replyOffset: msg.id,
        });

        if (this.SIGINT) {
          break;
        }
      }

      if (this.SIGINT) {
        await this.exitOnInterrupt();
      }

      if (
        lastMessageId >= (this.getDownloadState(id).limit || 0) ||
        messages.length < 100
      ) {
        break;
      }
    }
  }

  private async newDownload() {
    if (!this.client) throw new Error('TelegramClient undefined');
    cliDisplay.section('New download');
    cliDisplay.flow(['Target', 'Options', 'Media', 'Output', 'Review'], 0);
    cliDisplay.step(1, 5, 'Choose target');
    const query = await inquirer.prompt([
      {
        name: 'id',
        message: 'Target username or chat ID:',
      },
    ]);

    try {
      const res = await this.client.getEntity(query.id);
      cliDisplay.success(`Selected ${extractDisplayName(res) || query.id}.`);
      cliDisplay.flow(['Target', 'Options', 'Media', 'Output', 'Review'], 1);
      cliDisplay.step(2, 5, 'Choose archive options');
      const { metadata, includeReplies, useStartDate, startDateInput } =
        await inquirer.prompt([
          {
            name: 'metadata',
            message: 'Save metadata.json for message inspection?',
            type: 'confirm',
            default: false,
          },
          {
            name: 'includeReplies',
            message: 'Also scan comments and reply threads?',
            type: 'confirm',
            default: false,
          },
          {
            name: 'useStartDate',
            message: 'Limit download to messages after a date?',
            type: 'confirm',
            default: false,
          },
          {
            name: 'startDateInput',
            message:
              'Start date (YYYY-MM-DD, YYYY/MM/DD, or add HH:mm[:ss]):',
            when: (answers) => answers.useStartDate,
            validate: (input) => {
              try {
                parseDownloadStartDate(input);
                return true;
              } catch (err) {
                return err instanceof Error ? err.message : 'Invalid date';
              }
            },
          },
        ]);
      let mediaTypes: MediaType[] = [];
      cliDisplay.flow(['Target', 'Options', 'Media', 'Output', 'Review'], 2);
      cliDisplay.step(3, 5, 'Choose media types');
      while (mediaTypes.length <= 0) {
        mediaTypes = await checkbox({
          message: 'Media types to download',
          choices: [
            {
              name: 'Photos - images and Telegram albums',
              value: 'InputMessagesFilterPhotos',
            },
            {
              name: 'Videos - video files and clips',
              value: 'InputMessagesFilterVideo',
            },
            {
              name: 'Documents - PDFs, archives, and other files',
              value: 'InputMessagesFilterDocument',
            },
            {
              name: 'Music - audio tracks',
              value: 'InputMessagesFilterMusic',
            },
            {
              name: 'Voice messages - Telegram voice notes',
              value: 'InputMessagesFilterVoice',
            },
            {
              name: 'GIFs - animated media',
              value: 'InputMessagesFilterGif',
            },
          ],
        });
      }
      cliDisplay.flow(['Target', 'Options', 'Media', 'Output', 'Review'], 3);
      cliDisplay.step(4, 5, 'Choose output folder');
      const outPath = await ask('Output folder: ', {
        default: './telegram-downloads',
        validate: (input) =>
          input.trim().length > 0 ? true : 'Output folder cannot be empty',
      });
      const resolvedOutPath = this.resolveOutputPath(outPath);
      const startDate = useStartDate
        ? parseDownloadStartDate(startDateInput).toISOString()
        : undefined;

      const downloadState: DownloadState = {
        displayName: extractDisplayName(res),
        entityJson: res.toJSON(),
        outPath: resolvedOutPath,
        metadata,
        includeReplies,
        selectedMediaTypes: mediaTypes,
        mediaTypes: mediaTypes.map((e) => ({ type: e, offset: 0 })),
        replyOffset: 0,
        startDate,
        originalId: query.id,
      };

      cliDisplay.flow(['Target', 'Options', 'Media', 'Output', 'Review'], 4);
      cliDisplay.step(5, 5, 'Review');
      cliDisplay.panel('Download plan', this.summarizeState(downloadState));

      const { confirmed } = await inquirer.prompt({
        name: 'confirmed',
        message: 'Start download with this plan?',
        type: 'confirm',
        default: true,
      });

      if (!confirmed) {
        cliDisplay.info('Download cancelled before any files were written.');
        return this.main();
      }

      this.state.set(res.id.toString(), downloadState);
      await this.download(res);
    } catch (err) {
      cliDisplay.error(`Failed to retrieve chat: ${String(err)}`);
      this.main();
    }
  }

  private async download(entity: Entity) {
    if (!this.client) throw new Error('TelegramClient undefined');
    const id = entity.id.toString();
    this.stats = this.createStats();
    this.ensureDownloadDir(this.getDownloadState(id).outPath);

    cliDisplay.section('Downloading');
    cliDisplay.panel('Active plan', this.summarizeState(this.getDownloadState(id)));

    const queuedMediaTypes = [...this.getDownloadState(id).mediaTypes];
    cliDisplay.flow(
      queuedMediaTypes.map((entry) => this.mediaTypeLabel(entry.type))
    );
    for (const [index, mediaType] of queuedMediaTypes.entries()) {
      cliDisplay.flow(
        queuedMediaTypes.map((entry) => this.mediaTypeLabel(entry.type)),
        index
      );
      await this.downloadMediaType(
        entity,
        mediaType.type,
        index + 1,
        queuedMediaTypes.length
      );
    }

    if (this.getDownloadState(id).includeReplies) {
      await this.downloadReplyThreads(entity);
    }

    this.state.remove(id);
    await this.state.commit();
    cliDisplay.panel('Finished', [
      ['Downloaded', this.stats.downloaded],
      ['Failed', this.stats.failed],
      ['Messages scanned', this.stats.scanned],
      ['Reply threads', this.stats.replyThreads],
      ['Elapsed', this.formatDuration(Date.now() - this.stats.startedAt)],
    ]);
    cliDisplay.success('Download complete.');
    process.exit(0);
  }

  private async downloadMediaType(
    entity: Entity,
    mediaType: MediaType,
    index = 1,
    total = 1
  ) {
    if (!this.client) throw new Error('TelegramClient undefined');
    this.isDownloading = true;
    const id = entity.id.toString();
    const latestMessage = await this.client.getMessages(entity, { limit: 1 });
    const startOffset = await this.resolveStartOffset(entity, id);

    this.state.set(id, {
      ...this.getDownloadState(id),
      limit: latestMessage[0]?.id || 0,
    });

    const metadataOption = this.getDownloadState(id).metadata;
    let jsonSerializer;
    if (metadataOption) {
      jsonSerializer = new JsonSerializer(
        path.join(this.getDownloadState(id).outPath, 'metadata.json')
      );
    }

    this.ensureDownloadDir(this.getDownloadState(id).outPath);

    cliDisplay.step(index, total, `Download ${this.mediaTypeLabel(mediaType)}`);
    cliDisplay.panel('Scope', [
      ['Date range', this.formatStartDate(id)],
      ['Output', this.getDownloadState(id).outPath],
    ]);

    if (
      this.getDownloadState(id).startDate &&
      startOffset >= this.getDownloadState(id).limit!
    ) {
      cliDisplay.info('No messages found after the selected start date.');
      this.markMediaTypeDone(id, mediaType);
      return;
    }

    let batch = 1;
    while (true) {
      const mediaTypeState = this.getDownloadState(id).mediaTypes.find(
        (entry) => entry.type === mediaType
      );

      if (!mediaTypeState) {
        break;
      }

      let offset = mediaTypeState.offset || startOffset;

      const messages = await this.client.getMessages(entity, {
        limit: 1000,
        offsetId: offset,
        reverse: true,
        filter: getInputFilter(mediaType),
      });

      const mediaMessages = messages;
      this.stats.scanned += mediaMessages.length;

      if (mediaMessages.length === 0) {
        cliDisplay.action(
          `No more ${this.mediaTypeLabel(mediaType).toLowerCase()} found.`
        );
        this.markMediaTypeDone(id, mediaType);
        break;
      }

      cliDisplay.action(
        `Batch ${batch}: found ${mediaMessages.length} ${this.mediaTypeLabel(
          mediaType
        ).toLowerCase()}.`
      );
      batch += 1;

      const downloadDir = this.getDownloadState(id).outPath;
      let msgId = offset;
      for (const msg of mediaMessages) {
        try {
          await this.downloadMessage(msg, downloadDir);
          this.stats.downloaded += 1;
          msgId = msg.id;
        } catch (err: any) {
          this.stats.failed += 1;
          cliDisplay.warn(
            `Failed to download message ${msg.id}: ${String(
              err?.message || err
            )}`
          );
        }
        if (jsonSerializer) await jsonSerializer.append(msg);
        if (this.SIGINT) break;
      }

      offset = msgId;

      this.state.set(id, {
        ...this.getDownloadState(id),
        mediaTypes: this.getDownloadState(id).mediaTypes.map((e: any) => {
          if (e.type === mediaType)
            return {
              ...e,
              offset,
            };
          return e;
        }),
      });

      if (this.SIGINT) {
        await this.exitOnInterrupt();
      }
      if (offset >= this.getDownloadState(id).limit!) {
        this.markMediaTypeDone(id, mediaType);
        cliDisplay.success(`${this.mediaTypeLabel(mediaType)} finished.`);
        break;
      }
    }
  }

  private async resume() {
    if (!this.client) throw new Error('TelegramClient undefined');
    const activeDownloads = this.state.list();

    if (activeDownloads.length <= 0) {
      cliDisplay.info('No active downloads to resume.');
      return this.main();
    }

    cliDisplay.section('Resume download');
    cliDisplay.hint(
      'Each saved job shows: chat | date range | remaining work | output folder.'
    );
    const res = await inquirer.prompt({
      name: 'resume',
      type: 'list',
      message: 'Choose a saved download',
      choices: [
        ...activeDownloads.map((id) => ({
          name: this.formatResumeChoice(id),
          value: id,
        })),
        { name: 'Back', value: 'backbutton' },
      ],
    });

    if (res.resume === 'backbutton') {
      return this.main();
    }

    cliDisplay.panel('Resume plan', this.summarizeState(this.getDownloadState(res.resume)));
    const entityRes = await this.client.getEntity(
      this.getDownloadState(res.resume).entityJson.username ||
        this.getDownloadState(res.resume).originalId
    );
    this.download(entityRes);
  }

  async main() {
    cliDisplay.banner();
    let API_ID = this.credentials.get('API_ID');
    if (!API_ID) {
      API_ID = await ask('Telegram API_ID: ');
      this.credentials.set('API_ID', API_ID);
    }

    let API_HASH = this.credentials.get('API_HASH');
    if (!API_HASH) {
      API_HASH = await ask('Telegram API_HASH: ', {
        type: 'password',
      });
      this.credentials.set('API_HASH', API_HASH);
    }

    if (!this.client) {
      this.client = new TelegramClient(
        new StringSession(this.credentials.get('session')),
        parseInt(API_ID),
        API_HASH,
        {
          baseLogger: new Logger(LogLevel.NONE),
        }
      );
      this.client.setLogLevel(LogLevel.NONE);
    }

    if (this.client.disconnected) {
      await this.client.start({
        phoneNumber: ask.bind(undefined, 'Please enter your phone number: '),
        password: ask.bind(undefined, 'Please enter your password: ', {
          type: 'password',
        }),
        phoneCode: ask.bind(undefined, 'Please enter the code you received: ', {
          type: 'password',
        }),
        onError: (err) => console.log(err),
      });

      this.credentials.set(
        'session',
        await (this.client as any).session.save()
      );
    }

    const menu = await inquirer.prompt({
      name: 'option',
      type: 'list',
      message: 'What would you like to do?',
      choices: [
        {
          name: 'New download - choose chat, date, media, and output',
          value: 'new_download',
        },
        {
          name: 'Resume saved download - continue after an interruption',
          value: 'resume',
        },
        { name: 'Exit', value: 'exit' },
      ],
    });

    switch (menu.option) {
      case 'exit':
        process.exit(0);
      case 'new_download':
        this.newDownload();
        break;
      case 'resume':
        this.resume();
        break;
    }
  }

  run() {
    this.main();

    process.on('SIGINT', () => {
      cliDisplay.warn('Interrupt received.');
      if (!this.isDownloading) process.exit(0);
      this.SIGINT = true;
    });
  }

  getStoragePath() {
    return this.storage.path;
  }
}

export default TelegramBulkDownloader;
