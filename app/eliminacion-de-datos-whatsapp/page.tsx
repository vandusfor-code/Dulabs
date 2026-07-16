import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Eliminación de Datos de WhatsApp — Du Labs",
  description:
    "Cómo solicitar la eliminación de los datos asociados a tu cuenta de WhatsApp Business conectada a Du Labs.",
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
          <h1>Política de Eliminación de Datos de WhatsApp — Du Labs</h1>
          <p>Última actualización: abril de 2026</p>
          <p>
            En Du Labs, operado por RAMOS PADILLA DUVAN ANDRES, respetamos tu
            privacidad y los datos de tus clientes. Esta política explica
            cómo puedes solicitar la eliminación de los datos asociados a tu
            cuenta de WhatsApp Business conectada a través de nuestra
            plataforma.
          </p>

          <h2>1. ¿Qué datos recopilamos de WhatsApp?</h2>
          <p>
            Cuando conectas tu número de WhatsApp Business a Du Labs, podemos
            procesar:
          </p>
          <ul>
            <li>
              <strong>Datos del negocio:</strong> nombre, correo y número de
              teléfono conectado.
            </li>
            <li>
              <strong>Datos de conversación:</strong> mensajes enviados y
              recibidos, nombre del cliente final, fecha y hora.
            </li>
            <li>
              <strong>Datos técnicos:</strong> ID de WhatsApp, logs de
              webhooks y estado de mensajes.
            </li>
          </ul>
          <p>
            Usamos estos datos únicamente para: prestar el servicio de
            chatbot, generar reportes y cumplir con obligaciones legales.
          </p>

          <h2>2. ¿Cómo solicitar la eliminación de datos?</h2>
          <p>Tienes dos opciones:</p>

          <h3>Opción A: Desde tu panel de Du Labs</h3>
          <ul>
            <li>
              Inicia sesión en{" "}
              <a href="https://dulabs.co">dulabs.co</a>
            </li>
            <li>Ve a Números y busca la línea que quieres desconectar</li>
            <li>
              Haz clic en &quot;Eliminar mis datos&quot; y confirma. El
              número se desconecta de Meta y sus datos se borran de
              inmediato.
            </li>
          </ul>

          <h3>Opción B: Solicitud por correo</h3>
          <p>
            Envía un correo a:{" "}
            <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a>
          </p>
          <p>Asunto: SOLICITUD ELIMINACIÓN DATOS WHATSAPP</p>
          <p>
            Incluye: nombre del negocio, número de WhatsApp conectado y
            correo de la cuenta Du Labs.
          </p>
          <p>
            Responderemos y confirmaremos la eliminación en un máximo de 5
            días hábiles.
          </p>

          <h2>3. ¿Qué se elimina?</h2>
          <p>Al solicitar la eliminación:</p>
          <ul>
            <li>
              Desconectamos tu número de la WhatsApp Business API de Meta.
            </li>
            <li>
              Borramos todos los mensajes, logs y datos de clientes
              asociados a tu cuenta en nuestros servidores.
            </li>
            <li>Revocamos los permisos de acceso a tu WhatsApp Business.</li>
          </ul>
          <p>
            <strong>Nota:</strong> algunos datos pueden conservarse por 30
            días adicionales por temas de seguridad y respaldo, y luego se
            eliminan permanentemente. No vendemos ni compartimos tus datos
            con terceros.
          </p>

          <h2>4. Datos de tus clientes finales</h2>
          <p>
            Como negocio, tú eres el responsable de los datos de tus
            clientes. Al usar Du Labs te comprometes a tener el consentimiento
            de tus clientes para contactarlos por WhatsApp. Si un cliente
            final te pide borrar sus datos, escríbenos a{" "}
            <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a> con el
            número del cliente y su solicitud, y eliminamos su conversación de
            nuestros servidores.
          </p>

          <h2>5. Contacto</h2>
          <p>Para cualquier duda sobre esta política:</p>
          <ul>
            <li>Du Labs</li>
            <li>
              Correo: <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a>
            </li>
            <li>
              Web: <a href="https://dulabs.co">dulabs.co</a>
            </li>
          </ul>
        </article>
      </div>
    </main>
  );
}
