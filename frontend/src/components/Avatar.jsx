export default function Avatar({ user, size = 36 }) {
  const letter = (user?.name || '?').trim().charAt(0).toUpperCase();
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, background: 'var(--brand)', fontSize: size * 0.38 }}
    >
      {letter}
    </span>
  );
}
