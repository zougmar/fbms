export function latestProductImage(images) {
  if (!Array.isArray(images)) return '';
  for (let index = images.length - 1; index >= 0; index -= 1) {
    if (images[index]) return images[index];
  }
  return '';
}

export default function ProductImage({ src, alt = '', size = 44 }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="shrink-0 rounded-lg border object-cover"
      style={{ width: size, height: size, borderColor: 'var(--line)', background: 'var(--line)' }}
    />
  );
}
