type Message = {
  from: "user" | "bot";
  text: string;
  time: string;
};

type Chat = {
  product: string;
  tag: string;
  messages: Message[];
};

const chats: Chat[] = [
  {
    product: "Du Life",
    tag: "Personas",
    messages: [
      { from: "user", text: "Gasté 48.000 en mercado y pagué 120.000 del préstamo de Andrés", time: "8:42" },
      { from: "bot", text: "Registrado ✓ Mercado: $48.000 · Abono préstamo Andrés: $120.000. Saldo pendiente con Andrés: $380.000.", time: "8:42" },
      { from: "user", text: "¿Cuánto llevo gastado este mes?", time: "8:43" },
      { from: "bot", text: "Este mes llevas $1.284.000 en gastos. Vas 12% por debajo de tu promedio. 👌", time: "8:43" },
    ],
  },
  {
    product: "Du Academy",
    tag: "Equipos",
    messages: [
      { from: "bot", text: "Buenos días, Laura. Reto del día: ¿cómo respondes a un cliente que pide un descuento fuera de política?", time: "7:00" },
      { from: "user", text: "Le explico el valor del servicio y le ofrezco alternativas dentro de la política", time: "7:12" },
      { from: "bot", text: "Excelente enfoque ✓ Puntuación: 9/10. Tip: menciona siempre un beneficio concreto antes de hablar de precio.", time: "7:12" },
    ],
  },
  {
    product: "Du IA Business",
    tag: "Empresas",
    messages: [
      { from: "user", text: "Hola, ¿tienen disponibilidad para una cita mañana en la tarde?", time: "14:05" },
      { from: "bot", text: "¡Hola! Sí, mañana tenemos espacio a las 3:00 p.m. y 4:30 p.m. ¿Cuál prefieres?", time: "14:05" },
      { from: "user", text: "A las 3 está perfecto", time: "14:06" },
      { from: "bot", text: "Agendado ✓ Te llegará la confirmación y un recordatorio 2 horas antes. ¡Hasta mañana!", time: "14:06" },
    ],
  },
];

function Bubble({ message }: { message: Message }) {
  const isUser = message.from === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "rounded-br-sm bg-lime/15 text-lime-soft"
            : "rounded-bl-sm border border-edge bg-ink-2 text-white/90"
        }`}
      >
        <p>{message.text}</p>
        <p
          className={`mt-1 text-right text-[10px] ${
            isUser ? "text-lime/50" : "text-mist/60"
          }`}
        >
          {message.time} {isUser ? "✓✓" : ""}
        </p>
      </div>
    </div>
  );
}

export default function ChatShowcase() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {chats.map((chat) => (
        <div
          key={chat.product}
          className="rounded-2xl border border-edge bg-card/80 p-5 backdrop-blur-sm transition-colors duration-300 hover:border-lime/25"
        >
          <div className="mb-4 flex items-center justify-between border-b border-edge pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lime/10 text-[10px] font-bold text-lime">
                {chat.product.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{chat.product}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-mist">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                  en línea
                </p>
              </div>
            </div>
            <span className="rounded-full border border-edge px-2.5 py-1 text-[10px] uppercase tracking-wider text-mist">
              {chat.tag}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {chat.messages.map((message, i) => (
              <Bubble key={i} message={message} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
