import Image from 'next/image';
import { Brand } from './Brand';

export function AuthLayout({ title, subtitle, children }: { title: React.ReactNode; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="theme-light grid min-h-screen bg-paper text-char lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Brand />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-16">
          <h1 className="font-display text-[46px] leading-[1] tracking-[-0.015em]">{title}</h1>
          <p className="mb-9 mt-4 text-[15px] leading-relaxed text-char-3">{subtitle}</p>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-char lg:block">
        <Image src="/marketing/auth.jpg" alt="" fill priority sizes="50vw" className="object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-t from-char/80 via-char/10 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 text-paper">
          <p className="max-w-md font-display text-[32px] leading-[1.1]">“Make this window 40 cm wider and use black aluminium frames.”</p>
          <p className="mt-4 text-[13px] text-paper/60">One instruction, applied to the exact elements you selected.</p>
        </div>
      </div>
    </div>
  );
}
