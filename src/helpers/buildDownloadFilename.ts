import { Api } from 'telegram';
import getFilenameExtension from './getFilenameExtension';

type BuildDownloadFilenameOptions = {
  threadRootId?: number;
};

const pad = (value: number) => value.toString().padStart(2, '0');

const formatTimestampForFilename = (timestamp: number) => {
  const date = new Date(timestamp * 1000);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds()
  )}`;
};

const buildDownloadFilename = (
  message: Api.Message,
  options: BuildDownloadFilenameOptions = {}
) => {
  const nameParts = [formatTimestampForFilename(message.date)];

  if (message.groupedId) {
    nameParts.push(`album-${message.groupedId.toString()}`);
  }

  if (options.threadRootId !== undefined) {
    nameParts.push(`thread-${options.threadRootId}`);
    nameParts.push(`reply-${message.id}`);
  } else {
    nameParts.push(`msg-${message.id}`);
  }

  return `${nameParts.join('__')}.${getFilenameExtension(message)}`;
};

export default buildDownloadFilename;
