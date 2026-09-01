export default function VoixHi() {
  return (
    <div className="pointer-events-none absolute inset-0 z-9 overflow-hidden">
      <div className="group pointer-events-none absolute right-0 bottom-0 translate-x-1/2 translate-y-1/2 -rotate-45 transition-transform duration-300 ease-out hover:translate-x-0 hover:translate-y-0 hover:rotate-0 p-6">
        <h1 className="text-center bottom-full whitespace-nowrap text-5xl font-bold tracking-tight text-neon-red-soft glow-red opacity-0 transition-opacity duration-300 group-hover:opacity-100 sm:text-3xl">
          Hello!
        </h1>
        <img
          src="/vox.png"
          alt="Vox, the mascot"
          className="pointer-events-auto h-64 w-auto"
        />
      </div>
    </div>
  );
}
