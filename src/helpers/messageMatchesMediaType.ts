import { Api } from 'telegram';
import MediaType from '../types/MediaType';

const messageMatchesMediaType = (message: Api.Message, mediaType: MediaType) => {
  switch (mediaType) {
    case 'InputMessagesFilterPhotos':
      return Boolean(message.photo);
    case 'InputMessagesFilterVideo':
      return Boolean(message.video);
    case 'InputMessagesFilterDocument':
      return Boolean(
        message.document &&
          !message.video &&
          !message.audio &&
          !message.voice &&
          !message.gif
      );
    case 'InputMessagesFilterMusic':
      return Boolean(message.audio);
    case 'InputMessagesFilterVoice':
      return Boolean(message.voice);
    case 'InputMessagesFilterGif':
      return Boolean(message.gif);
    default:
      return false;
  }
};

export default messageMatchesMediaType;
