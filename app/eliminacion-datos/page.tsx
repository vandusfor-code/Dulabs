import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminación de Datos — Du Labs",
  description: "Instrucciones para la eliminación de datos de usuario en Du Labs.",
};

const ARTICLE_CLASSNAME =
  "mt-8 text-mist [&_a]:text-lime-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-fg [&_li]:leading-relaxed [&_p]:mt-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export default function EliminacionDatosPage() {
  return (
    <main className="bg-ink px-5 py-20 text-fg sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="text-sm text-lime-text transition-colors duration-200 hover:text-fg"
        >
          ← Volver a Du Labs
        </Link>
        <article className={ARTICLE_CLASSNAME}>
          <h1>Instrucciones para la Eliminación de Datos — Du Labs</h1>
          <p>Última actualización: 13 de julio de 2026</p>
          <p>
            En Du Labs (accesible a través de{" "}
            <a href="https://dulabs.co">https://dulabs.co</a>), valoramos la
            privacidad de tus datos y cumplimos estrictamente con las
            políticas de Meta plataformas respecto a la Solicitud de
            Eliminación de Datos de Usuarios (User Data Deletion Callback /
            Instructions).
          </p>
          <p>
            Si has conectado tu cuenta corporativa de Facebook o tu número de
            WhatsApp Business a nuestra aplicación y deseas revocar los
            permisos o eliminar por completo tus datos de nuestros
            servidores, puedes hacerlo de forma inmediata siguiendo estos
            pasos:
          </p>

          <h2>1. Cómo desvincular tu cuenta y eliminar tus datos</h2>
          <p>
            Tienes tres opciones directas para solicitar o ejecutar la
            eliminación de tu información:
          </p>
          <ul>
            <li>
              <strong>Opción A (Desde el Dashboard de Du Labs):</strong>{" "}
              Inicia sesión en tu panel de control, dirígete a la sección de
              &quot;Configuración de Canales&quot;, selecciona el número de
              WhatsApp vinculado y haz clic en &quot;Eliminar Canal /
              Desconectar&quot;. Este proceso revoca los tokens de acceso de
              Meta de forma automática y elimina las credenciales de sesión
              en nuestros servidores.
            </li>
            <li>
              <strong>Opción B (Desde tu cuenta de Facebook):</strong>
              <ul>
                <li>
                  Ve a la configuración de tu perfil de Facebook o Meta
                  Business Suite.
                </li>
                <li>
                  Navega a Configuración y Privacidad &gt; Configuración
                  &gt; Aplicaciones y sitios web.
                </li>
                <li>Busca la aplicación Du Labs.</li>
                <li>Haz clic en el botón Eliminar o Revocar accesos.</li>
              </ul>
            </li>
            <li>
              <strong>Opción C (Solicitud Directa):</strong> Si prefieres que
              nuestro equipo técnico realice la eliminación manual de todo tu
              historial de mensajes y registros de IA, envía una solicitud
              por correo electrónico a{" "}
              <a href="mailto:vandusfor@gmail.com">vandusfor@gmail.com</a>{" "}
              (o mediante nuestro canal de soporte en la web) con el asunto
              &quot;Eliminación de Datos - Du Labs&quot;. Procesaremos tu
              solicitud en un plazo menor a 48 horas hábiles.
            </li>
          </ul>

          <h2>2. Datos que son eliminados permanentemente</h2>
          <p>
            Al ejecutar la desvinculación o procesar tu solicitud, Du Labs
            borra de manera definitiva:
          </p>
          <ul>
            <li>
              Los tokens de acceso de la API oficial de WhatsApp generados
              durante el Embedded Signup.
            </li>
            <li>
              El historial temporal de mensajes procesados por la IA en tus
              chats.
            </li>
            <li>
              Cualquier configuración personalizada de prompts o
              instrucciones del bot asignadas a tu número.
            </li>
          </ul>
        </article>
      </div>
    </main>
  );
}
