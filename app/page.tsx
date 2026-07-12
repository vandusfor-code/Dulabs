import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Philosophy from "@/components/Philosophy";
import Products from "@/components/Products";
import Technology from "@/components/Technology";
import Differential from "@/components/Differential";
import Vision from "@/components/Vision";
import Trust from "@/components/Trust";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Philosophy />
        <Products />
        <Technology />
        <Differential />
        <Vision />
        <Trust />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
