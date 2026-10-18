import React, { useState } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Award,
  Share2,
  Download,
  Copy,
  Check,
  X,
  TrendingUp,
  Sparkles,
  Volume2,
  Clock,
  HelpCircle,
  ExternalLink
} from 'lucide-react';

export interface RecitationReportData {
  surahNumber: number;
  surahName: string;
  totalAyahs: number;
  completedAyahs: number;
  accuracyScore: number;
  tajweedScore: number;
  fluencyScore: number;
  hesitationCount: number;
  errorCount: number;
  perfectWordCount: number;
  reciterBenchmark: string;
  sessionDurationSeconds: number;
  testedMode: 'OPEN_MUSHAF' | 'BLIND_TEST';
  hesitationWords: string[];
  correctedWords: string[];
  pedagogicalRemarks: string[];
}

interface RecitationReportModalProps {
  report: RecitationReportData;
  onClose: () => void;
  onOpenCertificate: () => void;
}

export const RecitationReportModal: React.FC<RecitationReportModalProps> = ({
  report,
  onClose,
  onOpenCertificate
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [studentName, setStudentName] = useState<string>('الطالب الحافظ');

  const formattedDate = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const generateWhatsAppMessage = () => {
    const text = `السلام عليكم ورحمة الله وبركاته يا شيخنا الفاضل 🌸
نرفع إليكم تقرير التسميع والإتقان القرآني:
👤 الطالب: ${studentName}
📖 السورة: ${report.surahName} (${report.completedAyahs} من ${report.totalAyahs} آيات)
🎯 نمط التسميع: ${report.testedMode === 'BLIND_TEST' ? 'اختبار غيبي (عن ظهر قلب)' : 'تلاوة بالمصحف'}
⭐ نسبة الكلمات المكتملة: ${report.accuracyScore}%
✨ مؤشر الضبط اللفظي: ${report.tajweedScore}% (أحكام التجويد التخصصية تتطلب مشافهة الشيخ)
⏱️ مؤشر الانسيابية والطلاقة: ${report.fluencyScore}%
${report.hesitationWords.length > 0 ? `⚠️ مواضع التردد الملحوظة: ${report.hesitationWords.join('، ')}\n` : ''}
💡 المرجع الصوتي المعتمد: ${report.reciterBenchmark}
التاريخ: ${formattedDate}
— صادر عبر منصة معلّم القرآن الرقمي الذكية`;
    return encodeURIComponent(text);
  };

  const handleShareWhatsApp = () => {
    const encoded = generateWhatsAppMessage();
    const url = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(url, '_blank');
  };

  const handleCopySummary = () => {
    const text = `📊 تقرير تسميع ${report.surahName} للطالب ${studentName}:
• نسبة الكلمات المكتملة: ${report.accuracyScore}%
• مؤشر الضبط اللفظي: ${report.tajweedScore}%
• نمط التسميع: ${report.testedMode === 'BLIND_TEST' ? 'تسميع غيبي' : 'مصحف مرتّل'}
• تاريخ التسميع: ${formattedDate}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6" dir="rtl">
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-stone-200 overflow-hidden text-stone-900 my-auto flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-gradient-to-l from-emerald-950 via-stone-900 to-emerald-900 text-white px-6 py-5 flex items-center justify-between border-b border-emerald-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold font-arabic-heading text-white">
                  تقرير التسميع وقوة الحفظ التفصيلي
                </h2>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/40">
                  {report.testedMode === 'BLIND_TEST' ? 'اختبار غيبي موثّق' : 'تسميع مرتل بالمصحف'}
                </span>
              </div>
              <p className="text-xs text-stone-300 mt-0.5">
                {report.surahName} • {formattedDate}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-stone-800/80 hover:bg-stone-700 text-stone-300 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Student Name Input for personalized report */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-stone-50 rounded-2xl border border-stone-200/80">
            <div className="text-xs text-stone-600 font-medium">
              اسم الحافظ / الطالب لإدراجه بالتقرير والشهادة:
            </div>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              className="text-xs font-bold text-stone-900 px-3 py-1.5 rounded-xl border border-stone-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 w-full sm:w-48 text-right"
              placeholder="اكتب اسم الطالب..."
            />
          </div>

          {/* Primary Metrics Grid (4 Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-center">
              <div className="text-[11px] font-bold text-emerald-800 mb-1">نسبة الكلمات المكتملة</div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono">
                {report.accuracyScore}%
              </div>
              <div className="text-[10px] text-emerald-700 mt-1">
                {report.accuracyScore >= 90 ? 'إتقان تام للكلمات' : report.accuracyScore >= 75 ? 'جيد جداً' : 'يحتاج تثبيت'}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-center">
              <div className="text-[11px] font-bold text-amber-800 mb-1">مؤشر الضبط اللفظي</div>
              <div className="text-2xl sm:text-3xl font-black text-amber-950 font-mono">
                {report.tajweedScore}%
              </div>
              <div className="text-[10px] text-amber-700 mt-1">مطابقة الحروف (التجويد مشافهة)</div>
            </div>

            <div className="p-4 rounded-2xl bg-sky-50/80 border border-sky-200 text-center">
              <div className="text-[11px] font-bold text-sky-800 mb-1">سرعة الاستحضار</div>
              <div className="text-2xl sm:text-3xl font-black text-sky-950 font-mono">
                {report.fluencyScore}%
              </div>
              <div className="text-[10px] text-sky-700 mt-1">تدفق مسترسل دون تعثر</div>
            </div>

            <div className="p-4 rounded-2xl bg-stone-100 border border-stone-200 text-center">
              <div className="text-[11px] font-bold text-stone-700 mb-1">الآيات المنجزة</div>
              <div className="text-2xl sm:text-3xl font-black text-stone-900 font-mono">
                {report.completedAyahs}/{report.totalAyahs}
              </div>
              <div className="text-[10px] text-stone-500 mt-1">
                {report.completedAyahs === report.totalAyahs ? 'السورة كاملة' : 'مقطع محدد'}
              </div>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider">
              تفاصيل الأداء ومواضع الانتباه:
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Hesitation points */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/90 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-800">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span>مواضع التردد أو التوقف:</span>
                  </span>
                  <span className="font-mono text-amber-700">{report.hesitationCount} موضع</span>
                </div>
                {report.hesitationWords.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {report.hesitationWords.map((w, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-amiri-quran text-sm border border-amber-300"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-500 italic">
                    لم يُرصد أي تردد ملحوظ؛ الاستحضار كان سلساً بفضل الله.
                  </p>
                )}
              </div>

              {/* Correction Points */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/90 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-800">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>تنبيهات وتصحيحات المعلم:</span>
                  </span>
                  <span className="font-mono text-rose-700">{report.errorCount} تنبيه</span>
                </div>
                {report.correctedWords.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {report.correctedWords.map((w, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 font-amiri-quran text-sm border border-rose-300"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-500 italic">
                    أداء سليم تماماً من اللحن الجلي والخفي.
                  </p>
                )}
              </div>
            </div>

            {/* Pedagogical Guidance & Next Action */}
            <div className="p-4 rounded-2xl bg-emerald-950 text-white space-y-2">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold font-arabic-heading">
                <Sparkles className="w-4 h-4" />
                <span>توجيه المعلم التربوي وخطة التعاهد القادمة:</span>
              </div>
              <p className="text-xs sm:text-sm text-stone-200 leading-relaxed font-arabic-heading">
                {report.accuracyScore >= 95
                  ? `ما شاء الله تبارك الله، أداء راسخ وتلاوة متقنة. نوصيك بضم ${report.surahName} إلى الحزب الدائم ومراجعتها بعد ٣ أيام في إطار المراجعة المتباعدة.`
                  : report.accuracyScore >= 80
                  ? `أحسنت وبارك الله فيك، الحفظ مستقر بشكل عام مع حاجة طفيفة لتثبيت مواضع التردد. يُنصح بإعادة تسميع المقطع غيباً مرة إضافية اليوم.`
                  : `جهد مبارك ومأجور إن شاء الله؛ نوصيك بالاستماع للشيخ الحصري بتركيز مرتين متتاليتين ثم إعادة التسميع لترسيخ الذاكرة الصوتية.`}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="bg-stone-50 px-6 py-4 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleShareWhatsApp}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>إرسال للشيخ في واتساب</span>
            </button>
            <button
              onClick={handleCopySummary}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-stone-100 text-stone-700 text-xs font-semibold flex items-center gap-1.5 border border-stone-300 transition-all cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'تم النسخ!' : 'نسخ التقرير'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenCertificate}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <Award className="w-4 h-4" />
              <span>عرض شهادة الإتقان</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 text-xs font-semibold transition-all cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
