import Hero from '../components/Hero'
import LogoStrip from '../components/LogoStrip'
import FeatureGrid from '../components/FeatureGrid'
import HowItWorks from '../components/HowItWorks'
import TestimonialCarousel from '../components/TestimonialCarousel'
import PricingGrid from '../components/PricingGrid'
import FAQ from '../components/FAQ'

export default function Landing() {
  return (
    <>
      <Hero />
      <LogoStrip />
      <FeatureGrid />
      <HowItWorks />
      <TestimonialCarousel />
      <PricingGrid />
      <FAQ />
    </>
  )
}
