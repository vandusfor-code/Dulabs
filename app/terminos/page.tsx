import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos y Condiciones — Du Labs",
  description: "Términos y condiciones de servicio de Du Labs.",
};

const ARTICLE_CLASSNAME =
  "mt-8 text-mist [&_a]:text-lime-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-fg [&_li]:leading-relaxed [&_p]:mt-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export default function TerminosPage() {
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
          <h1>Términos y Condiciones de Servicio — Du Labs</h1>
          <p>Última actualización: 13 de julio de 2026</p>
          <p>
            Bienvenido a Du Labs (accesible a través de{" "}
            <a href="https://dulabs.co">https://dulabs.co</a>). Al
            registrarte, conectar tu cuenta y utilizar nuestra plataforma de
            automatización conversacional basada en inteligencia artificial,
            aceptas cumplir y quedar sujeto a los siguientes Términos y
            Condiciones de Servicio. Si no estás de acuerdo con alguna de
            estas cláusulas, deberás abstenerte de utilizar nuestro sistema.
          </p>

          <h2>1. Naturaleza del servicio</h2>
          <p>
            Du Labs es un software como servicio (SaaS) que permite a los
            usuarios integrar la API oficial de WhatsApp (Meta) con modelos
            de lenguaje de inteligencia artificial para automatizar la
            atención al cliente de sus negocios. Du Labs actúa única y
            exclusivamente como un intermediario técnico y proveedor de la
            infraestructura de procesamiento de datos.
          </p>

          <h2>2. Uso de la API de Meta y modo coexistencia</h2>
          <p>
            Al iniciar sesión con el Facebook de tu empresa y vincular tu
            número de WhatsApp Business, entiendes y aceptas que:
          </p>
          <ul>
            <li>
              Autorizas expresamente a Du Labs a enviar y recibir mensajes de
              WhatsApp en nombre de tu negocio mediante la API oficial de
              Meta.
            </li>
            <li>
              El servicio opera en &quot;modo coexistencia&quot;, lo que
              significa que seguirás usando tu aplicación móvil con
              normalidad mientras la IA atiende en paralelo, permitiéndote
              intervenir en los chats cuando lo desees.
            </li>
            <li>
              El usuario es el único responsable de cumplir estrictamente con
              las Políticas comerciales y de privacidad de WhatsApp Business
              establecidas por Meta.
            </li>
            <li>
              Du Labs no se hace responsable por suspensiones, bloqueos o
              baneos de números telefónicos por parte de Meta debido a
              sospechas de spam o violaciones a sus políticas de uso.
            </li>
          </ul>

          <h2>3. Limitación de responsabilidad de la inteligencia artificial</h2>
          <ul>
            <li>
              <strong>Supervisión del usuario:</strong> El usuario acepta que
              las respuestas son generadas de forma automatizada por modelos
              de Inteligencia Artificial. Du Labs no garantiza que las
              respuestas del bot sean 100% precisas, correctas o libres de
              errores en todo momento. Es responsabilidad del usuario
              supervisar el sistema e intervenir cuando sea necesario.
            </li>
            <li>
              <strong>Daños indirectos:</strong> En ningún caso Du Labs será
              responsable por pérdidas de ventas, malentendidos con clientes
              finales, o daños reputacionales derivados de una respuesta
              inadecuada generada por la IA.
            </li>
          </ul>

          <h2>4. Disponibilidad y pagos</h2>
          <ul>
            <li>
              Du Labs se esfuerza por mantener la plataforma disponible de
              forma continua, pero no se hace responsable por interrupciones
              del servicio causadas por caídas globales en los servidores de
              Meta (WhatsApp) o de nuestros proveedores de infraestructura en
              la nube.
            </li>
            <li>
              Nos reservamos el derecho de modificar los planes, límites de
              mensajes y precios del servicio notificándolo previamente a los
              usuarios.
            </li>
          </ul>

          <h2>5. Contacto</h2>
          <p>
            Para cualquier duda, aclaración o soporte legal relacionado con
            estos términos, puedes escribirnos directamente a:{" "}
            <a href="mailto:vandusfor@gmail.com">vandusfor@gmail.com</a>.
          </p>
        </article>
      </div>
    </main>
  );
}
