import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Mic,
  Volume2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  X,
  HelpCircle,
} from 'lucide-react';

interface FirstUserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface GuideStep {
  id: string;
  badge: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  content: React.ReactNode;
}

export const FirstUserGuideModal: React.FC<FirstUserGuideModalProps> = ({ isOpen, onClose }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem('aya_onboarding_dismissed', 'true');
      } catch {
        // Storage might be disabled in private mode
      }
    }
    onClose();
  };

  const steps: GuideStep[] = [
    {
      id: 'GUIDE-01',
      badge: 'الخطوة الأولى',
      title: 'مرحباً بك في مقرأة معلّم القرآن الرقمي',
      icon: Sparkles,
      color: 'emerald',
      content: (
        <div className="space-y-3 text-stone-700 text-xs sm:text-sm leading-relaxed text-right">
          <p className="font-semibold text-stone-900">
            أهلاً بك في منصة معلّم القرآن الرقمي الذكي لمساعدتك على مدارسة وتسميع القرآن الكريم برواية حفص عن عاصم.
          </p>
          <p>
            تم تصميم هذا التطبيق ليكون مساعداً تعليمياً ومرجعاً عملياً يرافقك أثناء التسميع الفردي، مع تحليل فوري للأداء وتنبيه لحظي لأحكام التجويد ومخارج الحروف.
          </p>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>تنبيه علمي وأمانة شرعية:</strong> هذا التطبيق وسيلة تدريبية لترسيخ الحفظ وضبط الأداء، ولا يُغني بحال عن العرض والمشافهة على المشايخ وأهل الإقراء المسندين لنيل الإجازة.
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'GUIDE-02',
      badge: 'الخطوة الثانية',
      title: 'كيف تبدأ جلسة التسميع في ٦ خطوات بسيطة',
      icon: BookOpen,
      color: 'emerald',
      content: (
        <div className="space-y-2 text-stone-700 text-xs sm:text-sm text-right">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">١. اختر السورة والآية:</span>
              <p className="text-2xs text-stone-600 mt-0.5">اختر من بين ١١٤ سورة كاملة من القائمة المنسدلة.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">٢. استمع للشيخ المعتمد:</span>
              <p className="text-2xs text-stone-600 mt-0.5">اضغط «استمع للشيخ» لسماع تلاوة الشيخ الحصري المحققة.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">٣. اضغط «ابدأ التسميع»:</span>
              <p className="text-2xs text-stone-600 mt-0.5">فعل المايكروفون لبدء استقبال صوتك مباشرة.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">٤. رتّل الآية بتؤدة:</span>
              <p className="text-2xs text-stone-600 mt-0.5">اقرأ بهدوء وترتيل مع مراعاة أزمنة المدود والغنن.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">٥. راقب التوجيه اللحظي:</span>
              <p className="text-2xs text-stone-600 mt-0.5">تتبع حركة الكلمات وملاحظات المعلم الصوتي الذكي.</p>
            </div>
            <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-emerald-800 text-xs">٦. استعرض التقرير:</span>
              <p className="text-2xs text-stone-600 mt-0.5">اطلع على درجات الدقة والطلاقة ومواضع التصحيح.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'GUIDE-03',
      badge: 'الخطوة الثالثة',
      title: 'إعداد المايكروفون والبيئة الصوتية',
      icon: Mic,
      color: 'amber',
      content: (
        <div className="space-y-3 text-stone-700 text-xs sm:text-sm leading-relaxed text-right">
          <p>لضمان أعلى دقة في التقاط صوتك وتوجيه التلاوة، يُرجى مراعاة ما يلي:</p>
          <ul className="space-y-2 text-xs">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>الموافقة على الإذن:</strong> سيطلب المتصفح صلاحية استخدام المايكروفون، اضغط «سماح» (Allow).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>بيئة هادئة:</strong> اقرأ في غرفة خالية من التلفاز، والمراوح المباشرة، والأحاديث الجانبية.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>مسافة المايكروفون:</strong> حافظ على مسافة ١٥ إلى ٢٠ سم من الجهاز بصوت طبيعي معتدل.</span>
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'GUIDE-04',
      badge: 'الخطوة الرابعة',
      title: 'ضوابط التسميع والتسجيل الصوتي',
      icon: Volume2,
      color: 'emerald',
      content: (
        <div className="space-y-3 text-stone-700 text-xs sm:text-sm leading-relaxed text-right">
          <p>لتحقيق أفضل نتائج التسميع الآلي:</p>
          <ul className="space-y-2 text-xs">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>البدء المباشر:</strong> انتظر ظهور مؤشر التقاط الصوت الأخضر، ثم ابدأ تلاوة الآية مباشرة دون مقدمات أو حديث تمهيدي.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>الترتيل المتزن:</strong> لا تسرع في القراءة، فالترتيل المحقق يساعد خوارزميات التتبع الصوتي على مطابقة كل حرف بدقة.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
              <span><strong>إنهاء الآية:</strong> بعد الانتهاء من آخر كلمة في الآية، اضغط «إيقاف التسميع» للاطلاع على النتيجة.</span>
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'GUIDE-05',
      badge: 'الخطوة الخامسة',
      title: 'دلالات ألوان الكلمات والتوجيه',
      icon: CheckCircle2,
      color: 'emerald',
      content: (
        <div className="space-y-2 text-stone-700 text-xs sm:text-sm text-right">
          <p className="text-xs mb-2">تتغير ألوان الكلمات في لوحة المصحف أثناء تلاوتك وفق الدلالات التالية:</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="font-bold text-emerald-900">أخضر (متقن):</span>
              <span className="text-stone-700">تم التحقق من صحة الكلمة ومطابقتها للأداء المعتمد.</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50 border border-amber-200">
              <span className="font-bold text-amber-900">أصفر نابض (الكلمة الحالية):</span>
              <span className="text-stone-700">موضع المتابعة اللحظي لموقعك أثناء القراءة.</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-rose-50 border border-rose-200">
              <span className="font-bold text-rose-900">أحمر (بحاجة لإعادة):</span>
              <span className="text-stone-700">رصد تعثر أو اختلاف صوتي يُرجى إعادة قراءته.</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-stone-50 border border-stone-200">
              <span className="font-bold text-stone-700">أبيض / رمادي:</span>
              <span className="text-stone-500">كلمات تالية لم تُقرأ بعد.</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'GUIDE-06',
      badge: 'الخطوة السادسة',
      title: 'التعامل مع عدم التأكد وإعادة المحاولة',
      icon: AlertTriangle,
      color: 'amber',
      content: (
        <div className="space-y-3 text-stone-700 text-xs sm:text-sm leading-relaxed text-right">
          <p className="font-semibold text-stone-900">
            «اليقين لا يزول بالشك» — قاعدتنا الأساسية في الحكم الصوتي
          </p>
          <p>
            إذا كان التسجيل مشوشاً أو غير واضح بسبب ضوضاء خارجية، لا يقوم النظام بتخطئتك، بل يتوقف احترازياً ويطلب منك إعادة التسميع بلطف.
          </p>
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700">
            <strong>ماذا تفعل إذا توقف التتبع؟</strong>
            <p className="mt-1">
              اضغط على زر «إعادة» للبدء من أول الآية، وتأكد من وضوح صوتك والهدوء حولك، ثم أعد القراءة بثقة.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'GUIDE-07',
      badge: 'الخطوة السابعة',
      title: 'الخصوصية والأمان الصوتي التام',
      icon: ShieldCheck,
      color: 'emerald',
      content: (
        <div className="space-y-3 text-stone-700 text-xs sm:text-sm leading-relaxed text-right">
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs">
            <strong className="block mb-1 text-sm">🔒 معالجة محلية ١٠٠٪ داخل متصفحك</strong>
            صوتك لا يُرفع ولا يُخزّن على أي خادم خارجي. المعالجة الصوتية تتم بالكامل داخل جهازك عبر الذكاء الاصطناعي المحلي (WebAssembly).
          </div>
          <ul className="space-y-1.5 text-xs text-stone-600">
            <li>• التسجيل الصوتي مؤقت في الذاكرة اللحظية فقط ويمسح فور انتهاء الجلسة.</li>
            <li>• ما يُحفظ في حسابك السحابي هو درجات الإتقان وإحصائيات الحفظ فقط.</li>
            <li>• خصوصيتك وأمان بياناتك الصوتية مضمونان تماماً.</li>
          </ul>
        </div>
      ),
    },
  ];

  const currentStep = steps[currentStepIndex];
  const StepIcon = currentStep.icon;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-xs animate-in fade-in duration-200" dir="rtl">
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-stone-200/90 overflow-hidden text-right flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-l from-emerald-950 to-stone-900 text-white p-5 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <StepIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[11px] font-bold text-emerald-300">
                {currentStep.badge} ({currentStepIndex + 1} من {steps.length})
              </div>
              <h2 className="text-base sm:text-lg font-bold font-arabic-heading text-white">
                {currentStep.title}
              </h2>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-stone-300 hover:text-white transition-all cursor-pointer"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          {currentStep.content}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 sm:p-5 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-stone-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded-md border-stone-300 text-emerald-800 focus:ring-emerald-700 w-4 h-4"
            />
            <span>عدم إظهار هذا الدليل تلقائياً مرة أخرى</span>
          </label>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {!isFirst && (
              <button
                onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
                className="px-3.5 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-700 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
                <span>السابق</span>
              </button>
            )}

            {isLast ? (
              <button
                onClick={handleDismiss}
                className="px-5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>فهمت، ابدأ التسميع</span>
              </button>
            ) : (
              <button
                onClick={() => setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
                className="px-5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <span>التالي</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Step Indicator Dots */}
        <div className="bg-stone-100 py-2 flex items-center justify-center gap-1.5 border-t border-stone-200/60">
          {steps.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStepIndex(idx)}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                idx === currentStepIndex ? 'w-6 bg-emerald-700' : 'w-1.5 bg-stone-300 hover:bg-stone-400'
              }`}
              title={`الانتقال للخطوة ${idx + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
