/**
 * @file App.tsx
 * @description Master Architecture & Foundation Dashboard for Quran Teacher AI.
 * Enhanced with full Firebase Real-time Synchronization, strict Auth RBAC,
 * and high-fidelity Islamic pedagogical UX.
 */

import React, { useState, Suspense, lazy } from 'react';
import { SyncProvider } from './context/SyncContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Header } from './components/Header.tsx';
import { FirebaseAuthModal } from './components/auth/FirebaseAuthModal.tsx';
import { UnifiedClassroomView } from './components/classroom/UnifiedClassroomView.tsx';

// Dynamic Code Splitting for Secondary Engineering, Governance, and Admin Dashboards
const ArchitectureView = lazy(() => import('./components/ArchitectureView.tsx').then(m => ({ default: m.ArchitectureView })));
const VerifiedQuranDashboard = lazy(() => import('./components/VerifiedQuranDashboard.tsx').then(m => ({ default: m.VerifiedQuranDashboard })));
const RecitationSessionView = lazy(() => import('./components/RecitationSessionView.tsx').then(m => ({ default: m.RecitationSessionView })));
const RealTimeRecitationView = lazy(() => import('./components/RealTimeRecitationView.tsx').then(m => ({ default: m.RealTimeRecitationView })));
const MemorizationRevisionDashboard = lazy(() => import('./components/MemorizationRevisionDashboard.tsx').then(m => ({ default: m.MemorizationRevisionDashboard })));
const QuranDataContractView = lazy(() => import('./components/QuranDataContractView.tsx').then(m => ({ default: m.QuranDataContractView })));
const TeacherEngineVisualizer = lazy(() => import('./components/TeacherEngineVisualizer.tsx').then(m => ({ default: m.TeacherEngineVisualizer })));
const ErrorTaxonomyView = lazy(() => import('./components/ErrorTaxonomyView.tsx').then(m => ({ default: m.ErrorTaxonomyView })));
const ScientificGovernanceView = lazy(() => import('./components/ScientificGovernanceView.tsx').then(m => ({ default: m.ScientificGovernanceView })));
const TestRunnerView = lazy(() => import('./components/TestRunnerView.tsx').then(m => ({ default: m.TestRunnerView })));
const RoadmapView = lazy(() => import('./components/RoadmapView.tsx').then(m => ({ default: m.RoadmapView })));
const StudentProgressDashboard = lazy(() => import('./components/StudentProgressDashboard.tsx').then(m => ({ default: m.StudentProgressDashboard })));
const TeacherAdminControlDashboard = lazy(() => import('./components/admin/TeacherAdminControlDashboard.tsx').then(m => ({ default: m.TeacherAdminControlDashboard })));
import {
  Layers,
  BookOpen,
  Cpu,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Map,
  Sparkles,
  Mic,
  GraduationCap,
  TrendingUp,
  Settings,
  Crown,
  Flame,
  LayoutGrid,
} from 'lucide-react';

type TabId =
  | 'UNIFIED_CLASSROOM'
  | 'TEACHER_ADMIN'
  | 'STUDENT_PROGRESS'
  | 'REALTIME_TEACHER'
  | 'MEMORIZATION_INTELLIGENCE'
  | 'RECITATION_SESSION'
  | 'VERIFIED_QURAN'
  | 'ARCHITECTURE'
  | 'TEACHER_ENGINE'
  | 'ERROR_TAXONOMY'
  | 'QURAN_CONTRACT'
  | 'GOVERNANCE'
  | 'TEST_SUITE'
  | 'ROADMAP';

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('UNIFIED_CLASSROOM');
  const [classroomSurah, setClassroomSurah] = useState<number>(1);
  const [classroomAyah, setClassroomAyah] = useState<number>(1);
  const { isAuthModalOpen, closeAuthModal, isAdmin, user } = useAuth();

  const handleStartRecitationFromDashboard = (surahId: number, startAyah: number) => {
    setClassroomSurah(surahId);
    setClassroomAyah(startAyah || 1);
    setActiveTab('UNIFIED_CLASSROOM');
  };

  // Primary 4 Master Workspaces
  const masterWorkspaces = [
    {
      id: 'UNIFIED_CLASSROOM' as TabId,
      title: 'مقرأة التسميع المباشرة',
      desc: 'تسميع بالمايكروفون ومصحف ملون بأحكام التجويد',
      icon: Mic,
      badge: 'الرئيسية',
      color: 'emerald',
    },
    {
      id: 'STUDENT_PROGRESS' as TabId,
      title: 'سجل الحفظ والتعاهد',
      desc: 'متابعة 114 سورة ومؤشر النسيان والشهادات',
      icon: TrendingUp,
      badge: 'إحصائيات',
      color: 'blue',
    },
    {
      id: 'TEACHER_ADMIN' as TabId,
      title: 'لوحة تحكم المشرف العام',
      desc: 'خاص بـ ahmed.sheta89@gmail.com ومراقبة الطلاب',
      icon: isAdmin ? Crown : Settings,
      badge: isAdmin ? '👑 مفعل' : 'مخصص للمشرف',
      color: 'amber',
    },
    {
      id: 'REALTIME_TEACHER' as TabId,
      title: 'التوجيه الصوتي والذكاء',
      desc: 'محاكاة المعلم الحقيقي والتصحيح التلقائي',
      icon: Sparkles,
      badge: 'Phase 7C',
      color: 'purple',
    },
  ];

  // Secondary Deep Engineering / Lab tabs
  const secondaryTabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'MEMORIZATION_INTELLIGENCE', label: 'ذكاء الحفظ والمراجعة (Phase 7D)', icon: GraduationCap },
    { id: 'RECITATION_SESSION', label: 'جلسة التسميع والاستماع (Phase 3)', icon: Mic },
    { id: 'VERIFIED_QURAN', label: 'القرآن والتجويد الموثق (Phase 2)', icon: ShieldCheck },
    { id: 'ARCHITECTURE', label: 'المعمارية والوحدات الـ 18', icon: Layers },
    { id: 'TEACHER_ENGINE', label: 'محاكي دورة المعلم (Engine)', icon: Cpu },
    { id: 'ERROR_TAXONOMY', label: 'تصنيف الأخطاء ونموذج الثقة', icon: AlertTriangle },
    { id: 'QURAN_CONTRACT', label: 'عقد بيانات الآيات (الفاتحة)', icon: BookOpen },
    { id: 'GOVERNANCE', label: 'الحوكمة والتحقق الشرعي', icon: ShieldCheck },
    { id: 'TEST_SUITE', label: 'فحص النطاق والاختبارات (1000+)', icon: CheckCircle2 },
    { id: 'ROADMAP', label: 'خريطة الطريق للمراحل القادمة', icon: Map },
  ];

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col font-sans selection:bg-emerald-900 selection:text-white" dir="rtl">
      {/* Header */}
      <Header onNavigateToAdmin={() => setActiveTab('TEACHER_ADMIN')} />

      {/* Primary Workspaces Navigation Grid */}
      <section className="bg-white border-b border-stone-200/80 shadow-2xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
            {masterWorkspaces.map((ws) => {
              const Icon = ws.icon;
              const active = activeTab === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => setActiveTab(ws.id)}
                  className={`p-2 sm:p-3 rounded-xl sm:rounded-2xl text-right transition-all flex flex-col justify-between border cursor-pointer active:scale-98 ${
                    active
                      ? 'bg-gradient-to-l from-emerald-950 to-stone-900 text-white shadow-md border-emerald-900 ring-2 ring-emerald-600/30'
                      : 'bg-stone-50/80 hover:bg-stone-100 text-stone-800 border-stone-200/90 hover:border-emerald-300'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1 sm:mb-1.5">
                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg sm:rounded-xl flex items-center justify-center ${
                      active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-stone-200 text-stone-700'
                    }`}>
                      <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${
                      active ? 'bg-white/10 text-emerald-200' : 'bg-stone-200/80 text-stone-600'
                    }`}>
                      {ws.badge}
                    </span>
                  </div>
                  <div>
                    <h3 className={`font-bold text-2xs sm:text-xs ${active ? 'text-white' : 'text-stone-900'}`}>
                      {ws.title}
                    </h3>
                    <p className={`hidden sm:block text-[11px] truncate mt-0.5 ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {ws.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Secondary tabs strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pt-3 mt-3 border-t border-stone-200/60 no-scrollbar">
            <span className="text-2xs font-bold text-stone-400 shrink-0 flex items-center gap-1">
              <LayoutGrid className="w-3 h-3" />
              <span>مختبر المعمارية والاختبارات:</span>
            </span>
            {secondaryTabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-1.5 rounded-xl text-2xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                    active
                      ? 'bg-emerald-900 text-white shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100 bg-white border border-stone-200/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-emerald-200' : 'text-stone-500'}`} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20 text-stone-600 font-arabic-heading" role="status" aria-live="polite">
              <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl shadow-xs border border-stone-200">
                <div className="w-5 h-5 border-2 border-emerald-800 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs sm:text-sm font-semibold text-stone-800">جاري تحميل واجهة العمل...</span>
              </div>
            </div>
          }
        >
          {activeTab === 'UNIFIED_CLASSROOM' && (
            <UnifiedClassroomView
              initialSurah={classroomSurah}
              initialAyah={classroomAyah}
            />
          )}
          {activeTab === 'TEACHER_ADMIN' && <TeacherAdminControlDashboard />}
          {activeTab === 'STUDENT_PROGRESS' && (
            <StudentProgressDashboard
              onStartRecitation={handleStartRecitationFromDashboard}
            />
          )}
          {activeTab === 'REALTIME_TEACHER' && <RealTimeRecitationView />}
          {activeTab === 'MEMORIZATION_INTELLIGENCE' && <MemorizationRevisionDashboard />}
          {activeTab === 'RECITATION_SESSION' && <RecitationSessionView />}
          {activeTab === 'VERIFIED_QURAN' && <VerifiedQuranDashboard />}
          {activeTab === 'ARCHITECTURE' && <ArchitectureView />}
          {activeTab === 'QURAN_CONTRACT' && <QuranDataContractView />}
          {activeTab === 'TEACHER_ENGINE' && <TeacherEngineVisualizer />}
          {activeTab === 'ERROR_TAXONOMY' && <ErrorTaxonomyView />}
          {activeTab === 'GOVERNANCE' && <ScientificGovernanceView />}
          {activeTab === 'TEST_SUITE' && <TestRunnerView />}
          {activeTab === 'ROADMAP' && <RoadmapView />}
        </Suspense>
      </main>

      {/* Top-Level Dedicated Firebase Auth Modal */}
      <FirebaseAuthModal
        isOpen={isAuthModalOpen}
        onClose={closeAuthModal}
        onNavigateToAdmin={() => setActiveTab('TEACHER_ADMIN')}
      />

      {/* Footer */}
      <footer className="border-t border-stone-200/80 bg-white py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-stone-500 space-y-2">
          <p className="font-arabic-heading font-semibold text-stone-700">
            Quran Teacher AI &bull; معلّم القرآن الرقمي
          </p>
          <p>
            تأسيس معماري رصين خاضع لقواعد التحقق العلمي والشرعي الصارم &bull; موثق برواية حفص عن عاصم
          </p>
          <div className="text-[11px] text-stone-400 font-mono">
            Clean Architecture &bull; Firestore Cloud Sync &bull; Zero Religious Hallucination Guarantee
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <AppContent />
      </SyncProvider>
    </AuthProvider>
  );
}
