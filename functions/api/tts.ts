import { handleRecapTts } from '../../server/tts/handler';

export const onRequest = ({ request }: { request: Request }) => handleRecapTts(request);
