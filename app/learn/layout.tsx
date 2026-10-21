import { LearningHeaderOffset } from "@/components/learning-header-offset";

export default function LearningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LearningHeaderOffset />
      {children}
    </>
  );
}
