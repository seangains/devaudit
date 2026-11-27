import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import StatsSection from "@/components/StatsSection";
import WaveDivider from "@/components/WaveDivider";
import ScrollStack from "@/components/ScrollStack";
import DashboardShowcase from "@/components/DashboardShowcase";
import WorkflowSplit from "@/components/WorkflowSplit";
import AISection from "@/components/AISection";
import IntegrationsHub from "@/components/IntegrationsHub";
import Testimonials from "@/components/Testimonials";
import UsageMap from "@/components/UsageMap";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";

export default function Page() {
  return (
    <main>
      <Navbar />
      <Hero />
      <StatsSection />

      <WaveDivider
        label="Product"
        title="The whole product, at full size."
        sub="Every screen your team uses, from the first push to the finished autopsy."
      />
      <ScrollStack />

      <WaveDivider
        id="features"
        label="Platform"
        title="Everything your team needs to stop repeating bugs."
        sub="Two panels of the same dashboard your team opens every day: the live feed, and the fix it hands you."
      />
      <DashboardShowcase />

      <WaveDivider
        label="Workflow"
        title="From the push to the post-mortem."
        sub="Follow one failure from the commit that caused it to the patch that fixes it."
      />
      <WorkflowSplit />

      <WaveDivider
        label="DevAudit AI"
        title="An engineer that reads every failure."
        sub="It reads what you would, and writes down what it finds."
      />
      <AISection />

      <IntegrationsHub />

      <WaveDivider
        label="Customers"
        title="Teams read fewer stack traces out loud."
        sub="What engineering teams say after their first few autopsies."
      />
      <Testimonials />

      <UsageMap />
      <FAQ />
      <Footer />
    </main>
  );
}
