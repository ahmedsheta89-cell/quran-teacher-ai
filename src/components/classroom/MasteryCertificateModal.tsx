import React, { useState, useEffect } from 'react';
import { Award, CheckCircle2, Download, Printer, Share2, X, ShieldCheck } from 'lucide-react';
import { saveCertificateToFirestore } from '../../infrastructure/firebase/firebaseClient.ts';

interface MasteryCertificateModalProps {
  surahName: string;
  surahNumber: number;
  accuracyScore: number;
  tajweedScore: number;
  onClose: () => void;
  studentNameDefault?: string;
}

export const MasteryCertificateModal: React.FC<MasteryCertificateModalProps> = ({
  surahName,
  surahNumber,
  accuracyScore,
  tajweedScore,
  onClose,
  studentNameDefault,
}) => {
  const [studentName, setStudentName] = useState<string>(
    () => studentNameDefault || (typeof window !== 'undefined' ? localStorage.getItem('quran_teacher_student_name') : null) || 'أحمد بن عبد الله'
  );
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const issueDate = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const certificateId = `QUR-CERT-${surahNumber}-${Math.floor(100000 + Math.random() * 900000)}`;

  useEffect(() => {
    // Only persist certificate if student has achieved verified mastery threshold (>= 80%)
    if (accuracyScore < 80) return;

    saveCertificateToFirestore({
      certificateId,
      studentName,
      surahNumber,
      surahName,
      accuracyScore,
      verificationHash: certificateId,
    }).catch(() => {
      // Offline mode or guest user
    });
  }, [certificateId, studentName, surahNumber, surahName, accuracyScore]);

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    const text = `📜 بفضل الله وتوفيقه، أتممت تسميع وإتقان ${surahName} برواية حفص عن عاصم بدرجة إتقان ${accuracyScore}% عبر منصة معلّم القرآن الرقمي.\nرقم التوثيق: ${certificateId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6" dir="rtl">
      <div className="relative w-full max-w-4xl bg-stone-900 rounded-3xl shadow-2xl border border-amber-500/30 overflow-hidden text-stone-100 my-auto">
        {/* Top Action Bar (hidden during print) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 bg-stone-950/60 print:hidden">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-sm sm:text-base text-amber-200 font-arabic-heading">
              شهادة إتقان وضبط قرآني مرحلية
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title="طباعة الشهادة"
            >
              <Printer className="w-4 h-4 text-stone-300" />
              <span className="hidden sm:inline">طباعة</span>
            </button>
            <button
              onClick={handleShare}
              className="px-3 py-1.5 rounded-xl bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-emerald-700/50"
              title="مشاركة الشهادة"
            >
              <Share2 className="w-4 h-4" />
              <span>{copied ? 'تم النسخ!' : 'مشاركة التزكية'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-stone-800/80 hover:bg-stone-700 text-stone-400 hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Certificate Outer Frame */}
        <div className="p-4 sm:p-8 bg-[#fdfcf7] text-stone-900 select-none print:p-0 print:bg-white print:text-black">
          {/* Ornate Double Border */}
          <div className="relative border-4 border-[#b89758] p-6 sm:p-10 rounded-2xl bg-radial from-[#fffefc] to-[#fbf8ed] shadow-inner">
            {/* Islamic Floral Corner Accents */}
            <div className="absolute top-2 right-2 w-12 h-12 border-t-4 border-r-4 border-[#8c6b2d] rounded-tr-xl pointer-events-none"></div>
            <div className="absolute top-2 left-2 w-12 h-12 border-t-4 border-l-4 border-[#8c6b2d] rounded-tl-xl pointer-events-none"></div>
            <div className="absolute bottom-2 right-2 w-12 h-12 border-b-4 border-r-4 border-[#8c6b2d] rounded-br-xl pointer-events-none"></div>
            <div className="absolute bottom-2 left-2 w-12 h-12 border-b-4 border-l-4 border-[#8c6b2d] rounded-bl-xl pointer-events-none"></div>

            {/* Header / Bismillah */}
            <div className="text-center space-y-3 mb-6">
              <div className="text-amber-900 font-amiri-quran text-2xl sm:text-3xl font-bold tracking-wider">
                بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-amber-100/80 border border-amber-300 text-amber-900 text-xs font-bold uppercase tracking-widest">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                <span>شهادة إتقان وضبط قرآني موثقة</span>
              </div>
            </div>

            {/* Main Certificate Body */}
            <div className="text-center space-y-6 max-w-2xl mx-auto my-6">
              <p className="text-sm sm:text-base text-stone-600 leading-relaxed">
                يشهد محرك التحقق الصوتي والضبط العلمي المعتمد في <span className="font-bold text-stone-900">منظومة معلّم القرآن الرقمي</span> بأن القارئ المبارك:
              </p>

              {/* Student Name */}
              <div className="py-2">
                {isEditingName ? (
                  <div className="flex items-center justify-center gap-2">
                    <input
                      type="text"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="text-2xl sm:text-3xl font-bold font-arabic-heading text-center text-emerald-950 border-b-2 border-emerald-700 bg-transparent focus:outline-hidden px-4"
                      autoFocus
                      onBlur={() => setIsEditingName(false)}
                      onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                    />
                    <button
                      onClick={() => setIsEditingName(false)}
                      className="text-xs bg-emerald-800 text-white px-2.5 py-1 rounded-lg"
                    >
                      حفظ
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => setIsEditingName(true)}
                    className="group cursor-pointer inline-flex items-center justify-center gap-2 border-b-2 border-[#b89758]/50 pb-1 px-6 hover:border-amber-700 transition-all"
                    title="انقر لتعديل الاسم"
                  >
                    <span className="text-2xl sm:text-4xl font-bold font-arabic-heading text-stone-950 tracking-wide">
                      {studentName}
                    </span>
                    <span className="text-[10px] text-amber-700 opacity-0 group-hover:opacity-100 transition-all print:hidden">
                      (تعديل)
                    </span>
                  </div>
                )}
              </div>

              {/* Achievement Text */}
              <p className="text-sm sm:text-base text-stone-700 leading-relaxed px-4">
                قد أتمّ بحمد الله وتوفيقه تسميع وضبط كلمات الآيات المقررة من <span className="font-bold text-emerald-900 text-base sm:text-lg">{surahName}</span>، بمطابقة تامة لمصحف المدينة المنورة برواية <span className="font-bold text-stone-900">حفص عن عاصم من طريق الشاطبية</span>، مع التنبيه إلى أن الإجازة التجويدية التخصصية تتطلب المشافهة والعرض على المشايخ المسندين.
              </p>

              {/* Scores Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 my-6 py-4 border-y border-amber-200/80 bg-[#f9f5e9]/60 rounded-xl px-4">
                <div className="text-center">
                  <div className="text-xs text-stone-500 font-medium">نسبة الكلمات المكتملة</div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-900 font-mono mt-0.5">
                    {accuracyScore}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-stone-500 font-medium">مؤشر الضبط اللفظي</div>
                  <div className="text-xl sm:text-2xl font-black text-amber-900 font-mono mt-0.5">
                    {tajweedScore}%
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1 text-center">
                  <div className="text-xs text-stone-500 font-medium">مرجع التحقيق الصوتي</div>
                  <div className="text-xs sm:text-sm font-bold text-stone-800 mt-1">
                    المصحف المرتل (الحصري)
                  </div>
                </div>
              </div>

              {/* Prophetic Hadith Encouragement */}
              <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 text-xs sm:text-sm text-stone-800 font-arabic-heading italic leading-relaxed">
                «يُقَالُ لِصَاحِبِ الْقُرْآنِ: اقْرَأْ وَارْتَقِ وَرَتِّلْ كَمَا كُنْتَ تُرَتِّلُ فِي الدُّنْيَا، فَإِنَّ مَنْزِلَتَكَ عِنْدَ آخِرِ آيَةٍ تَقْرَؤُهَا»
              </div>
            </div>

            {/* Footer Signatures and Verification Seal */}
            <div className="mt-8 pt-6 border-t border-amber-300/70 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-stone-600">
              {/* Digital Seal */}
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-amber-700 bg-amber-50 flex flex-col items-center justify-center p-1 text-center shadow-xs">
                  <Award className="w-5 h-5 text-amber-700" />
                  <span className="text-[8px] font-bold text-amber-900 uppercase">ختم الإتقان</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-stone-900">المقرأة الرقمية الذكية</div>
                  <div className="text-[10px] text-stone-500 font-mono">{certificateId}</div>
                  <div className="text-[10px] text-stone-500">{issueDate}</div>
                </div>
              </div>

              {/* Trust Badge & Guarantee */}
              <div className="text-center sm:text-left text-[11px] text-stone-500 space-y-1">
                <div className="flex items-center justify-center sm:justify-start gap-1 font-bold text-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>معتمد وفق مصحف المدينة النبوية</span>
                </div>
                <div>رواية حفص عن عاصم من طريق الشاطبية</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
