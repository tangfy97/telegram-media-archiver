import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import Byteroo, { Container } from 'byteroo';
import { Entity } from 'telegram/define';
import extractDisplayName from './helpers/extractDisplayName';
import ask from './helpers/ask';
import buildDownloadFilename from './helpers/buildDownloadFilename';
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
  originalId: string;
  includeReplies?: boolean;
  limit?: number;
  replyOffset?: number;
  startDate?: string;
};

class TelegramBulkDownloader {
  private storage: Byteroo;
  private credentials: Container;
  private state: Container;
  isDownloading: boolean;
  private SIGINT: boolean;
  private client?: TelegramClient;
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
  }

  private getDownloadState(id: string) {
    return this.state.get(id) as DownloadState;
  }

  private getDownloadStartDate(id: string) {
    const startDate = this.getDownloadState(id).startDate;
    return startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : undefined;
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
        format: `${targetFileName} {bar} {percentage}% | ETA: {eta}s`,
      },
      cliProgress.Presets.legacy
    );

    bar.start(100, 0);

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
    console.log(`Exiting, SIGINT=${this.SIGINT}`);
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
    const selectedMediaTypes = this.getDownloadState(id).mediaTypes.map(
      (entry) => entry.type
    );
    const downloadDir = this.getDownloadState(id).outPath;
    const startDate = this.getDownloadStartDate(id);
    let offset = 0;

    while (true) {
      const messages = await this.client.getMessages(entity, {
        limit: 100,
        offsetId: offset,
        offsetDate: startDate,
        reverse: true,
        replyTo: rootMessage.id,
      });

      if (messages.length === 0) {
        break;
      }

      let lastReplyId = 0;
      for (const replyMessage of messages) {
        lastReplyId = replyMessage.id;

        if (jsonSerializer) {
          await jsonSerializer.append(replyMessage);
        }

        if (
          selectedMediaTypes.some((mediaType) =>
            messageMatchesMediaType(replyMessage, mediaType)
          )
        ) {
          await this.downloadMessage(
            replyMessage,
            downloadDir,
            buildDownloadFilename(replyMessage, {
              threadRootId: rootMessage.id,
            })
          );
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
    const startDate = this.getDownloadStartDate(id);

    this.ensureDownloadDir(downloadDir);

    let jsonSerializer;
    if (downloadState.metadata) {
      jsonSerializer = new JsonSerializer(path.join(downloadDir, 'metadata.json'));
    }

    console.log(
      'Scanning messages with comments/reply threads. This can take longer on large chats.'
    );

    while (true) {
      const offset = this.getDownloadState(id).replyOffset || 0;
      const messages = await this.client.getMessages(entity, {
        limit: 100,
        offsetId: offset,
        offsetDate: startDate,
        reverse: true,
      });

      if (messages.length === 0) {
        break;
      }

      let lastMessageId = offset;
      for (const msg of messages) {
        lastMessageId = msg.id;

        if (msg.replies) {
          try {
            await this.downloadRepliesForMessage(entity, msg, jsonSerializer);
          } catch (err: any) {
            if (
              err?.errorMessage === 'PEER_ID_INVALID' ||
              String(err?.message || err).includes('PEER_ID_INVALID')
            ) {
              console.warn(
                'Comments/reply thread downloads are not available for this chat type.'
              );
              return;
            }

            console.warn(
              `Failed to download replies for message ${msg.id}:`,
              err
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
    const query = await inquirer.prompt([
      {
        name: 'id',
        message: 'Please enter username or chat id of target: ',
      },
    ]);

    try {
      const res = await this.client.getEntity(query.id);
      const { metadata, includeReplies, useStartDate, startDateInput } =
        await inquirer.prompt([
        {
          name: 'metadata',
          message: 'Do you want to include metadata.json? (Recommended: no)',
          type: 'confirm',
        },
          {
            name: 'includeReplies',
            message:
              'Do you want to include comments/reply threads? (Slower on large chats)',
            type: 'confirm',
          },
          {
            name: 'useStartDate',
            message: 'Do you want to start downloading from a specific date?',
            type: 'confirm',
          },
          {
            name: 'startDateInput',
            message:
              'Enter the start date (YYYY-MM-DD or YYYY-MM-DD HH:mm[:ss]): ',
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
      while (mediaTypes.length <= 0) {
        mediaTypes = await checkbox({
          message: 'Select media types to download',
          choices: [
            { name: 'Pictures', value: 'InputMessagesFilterPhotos' },
            { name: 'Videos', value: 'InputMessagesFilterVideo' },
            { name: 'Documents', value: 'InputMessagesFilterDocument' },
            { name: 'Music', value: 'InputMessagesFilterMusic' },
            { name: 'Voice messages', value: 'InputMessagesFilterVoice' },
            { name: 'GIFs', value: 'InputMessagesFilterGif' },
          ],
        });
      }
      const outPath = await ask('Enter the folder path for file storage: ');
      const startDate = useStartDate
        ? parseDownloadStartDate(startDateInput).toISOString()
        : undefined;

      this.state.set(res.id.toString(), {
        displayName: extractDisplayName(res),
        entityJson: res.toJSON(),
        outPath: path.resolve(outPath),
        metadata,
        includeReplies,
        mediaTypes: mediaTypes.map((e) => ({ type: e, offset: 0 })),
        replyOffset: 0,
        startDate,
        originalId: query.id
      });
      await this.download(res);
    } catch (err) {
      console.error('Failed to retrieve chat', err);
      this.main();
    }
  }

  private async download(entity: Entity) {
    if (!this.client) throw new Error('TelegramClient undefined');
    const id = entity.id.toString();

    for (const mediaType of this.getDownloadState(id).mediaTypes) {
      await this.downloadMediaType(entity, mediaType.type);
    }

    if (this.getDownloadState(id).includeReplies) {
      await this.downloadReplyThreads(entity);
    }

    this.state.remove(id);
    await this.state.commit();
    process.exit(0);
  }

  private async downloadMediaType(entity: Entity, mediaType: MediaType) {
    if (!this.client) throw new Error('TelegramClient undefined');
    this.isDownloading = true;
    const id = entity.id.toString();
    const latestMessage = await this.client.getMessages(entity, { limit: 1 });
    const startDate = this.getDownloadStartDate(id);

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

    while (true) {
      const mediaTypeState = this.getDownloadState(id).mediaTypes.find(
        (entry) => entry.type === mediaType
      );

      if (!mediaTypeState) {
        break;
      }

      let offset = mediaTypeState.offset;

      const messages = await this.client.getMessages(entity, {
        limit: 1000,
        offsetId: offset,
        offsetDate: startDate,
        reverse: true,
        filter: getInputFilter(mediaType),
      });

      const mediaMessages = messages;

      if (mediaMessages.length === 0) {
        break;
      }

      const downloadDir = this.getDownloadState(id).outPath;
      let msgId = offset;
      for (const msg of mediaMessages) {
        try {
          await this.downloadMessage(msg, downloadDir);
          msgId = msg.id;
        } catch (err) {
          console.warn(err);
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
        this.state.set(id, {
          ...this.getDownloadState(id),
          mediaTypes: this.state
            .get(id)
            .mediaTypes.filter((e: any) => e.type !== mediaType),
        });
        break;
      }
    }
  }

  private async resume() {
    if (!this.client) throw new Error('TelegramClient undefined');
    const res = await inquirer.prompt({
      name: 'resume',
      type: 'list',
      message: 'Choose a chat',
      choices: [
        ...this.state
          .list()
          .map((e) => ({ name: this.state.get(e).displayName || e, value: e })),
        { name: 'Back', value: 'backbutton' },
      ],
    });

    if (res.resume === 'backbutton') {
      return this.main();
    }

    const entityRes = await this.client.getEntity(
      this.state.get(res.resume).entityJson.username ||
        this.state.get(res.resume).originalId
    );
    this.download(entityRes);
  }

  async main() {
    let API_ID = this.credentials.get('API_ID');
    if (!API_ID) {
      API_ID = await ask('Please provide your API_ID: ');
      this.credentials.set('API_ID', API_ID);
    }

    let API_HASH = this.credentials.get('API_HASH');
    if (!API_HASH) {
      API_HASH = await ask('Please provide your API_HASH: ', {
        type: 'password',
      });
      this.credentials.set('API_HASH', API_HASH);
    }

    if (!this.client) {
      this.client = new TelegramClient(
        new StringSession(this.credentials.get('session')),
        parseInt(API_ID),
        API_HASH,
        {}
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
      message: 'Choose an option',
      choices: [
        { name: 'Start new download', value: 'new_download' },
        { name: 'Resume active download', value: 'resume' },
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
      console.log('Caught interrupt signal');
      if (!this.isDownloading) process.exit(0);
      this.SIGINT = true;
    });
  }

  getStoragePath() {
    return this.storage.path;
  }
}

export default TelegramBulkDownloader;
