import { useEffect, useState } from 'react';

export function AttachmentThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" width={36} height={36}
    style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} /> : null;
}
