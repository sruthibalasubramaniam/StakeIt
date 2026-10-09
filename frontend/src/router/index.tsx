import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, homePathFor } from '../layouts/AppShell';
import { AuthLayout } from '../layouts/AuthLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { RouteErrorPage } from '../pages/errors/ErrorPages';
import { useAuth } from '../context/AuthContext';
import { AppBootSplash } from '../layouts/AppShell';

/* Auth */
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';

/* Learner */
import { DashboardPage } from '../pages/learner/DashboardPage';
import { CataloguePage } from '../pages/learner/CataloguePage';
import { CourseDetailPage } from '../pages/learner/CourseDetailPage';
import { EnrollmentPage } from '../pages/learner/EnrollmentPage';
import { MyCoursesPage } from '../pages/learner/MyCoursesPage';
import { LearningHubPage } from '../pages/learner/LearningHubPage';
import { ContentPage } from '../pages/learner/ContentPage';
import { QuizPage } from '../pages/learner/QuizPage';
import { AssessmentPage } from '../pages/learner/AssessmentPage';
import { FinalTestPage } from '../pages/learner/FinalTestPage';
import { CompletionPage } from '../pages/learner/CompletionPage';
import { WalletPage } from '../pages/learner/WalletPage';
import { StakesPage } from '../pages/learner/StakesPage';
import { RewardsPage } from '../pages/learner/RewardsPage';
import { NotificationsPage } from '../pages/learner/NotificationsPage';

/* Instructor */
import { InstructorDashboardPage } from '../pages/instructor/InstructorDashboardPage';
import { InstructorCoursesPage } from '../pages/instructor/InstructorCoursesPage';
import { CourseFormPage } from '../pages/instructor/CourseFormPage';
import { CourseBuilderPage } from '../pages/instructor/CourseBuilderPage';
import { CourseLearnersPage } from '../pages/instructor/CourseLearnersPage';
import { CourseAnalyticsPage } from '../pages/instructor/CourseAnalyticsPage';

/* Admin */
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { AdminCoursesPage } from '../pages/admin/AdminCoursesPage';
import { AdminInstructorsPage } from '../pages/admin/AdminInstructorsPage';
import { AdminRewardPoolPage } from '../pages/admin/AdminRewardPoolPage';
import { AdminBadgesPage } from '../pages/admin/AdminBadgesPage';
import { AdminAnalyticsPage } from '../pages/admin/AdminAnalyticsPage';

/* Shared */
import { ProfilePage } from '../pages/shared/ProfilePage';
import { InstructorProfilePage } from '../pages/shared/InstructorProfilePage';

/** Sends an authenticated visitor to the home screen for their role. */
function RoleHome() {
  const { user, initialising } = useAuth();
  if (initialising) return <AppBootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(user.role)} replace />;
}

/**
 * Route table.
 *
 * Two shells: `AuthLayout` for sign-in/registration, and `AppShell` for
 * everything else. `ProtectedRoute` only hides UI — the Express API re-checks
 * every role and every ownership rule on each request.
 */
export function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<AuthLayout />} errorElement={<RouteErrorPage />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Authenticated application shell */}
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
        errorElement={<RouteErrorPage />}
      >
        {/* Learner */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catalogue is readable by every signed-in role */}
        <Route path="/courses" element={<CataloguePage />} />
        <Route path="/courses/:idOrSlug" element={<CourseDetailPage />} />
        <Route
          path="/courses/:idOrSlug/enroll"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <EnrollmentPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/my-courses"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <MyCoursesPage />
            </ProtectedRoute>
          }
        />

        {/* Learning */}
        <Route
          path="/learn/:enrollmentId"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <LearningHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/:enrollmentId/content/:contentId"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <ContentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/:enrollmentId/quiz/:quizId"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <QuizPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/:enrollmentId/assessment/:assessmentId"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <AssessmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/:enrollmentId/final-test"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <FinalTestPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/:enrollmentId/completion"
          element={
            <ProtectedRoute allow={['LEARNER']}>
              <CompletionPage />
            </ProtectedRoute>
          }
        />

        {/* Learner wallet surfaces */}
        <Route path="/stakes" element={<ProtectedRoute allow={['LEARNER']}><StakesPage /></ProtectedRoute>} />
        <Route path="/rewards" element={<ProtectedRoute allow={['LEARNER']}><RewardsPage /></ProtectedRoute>} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/instructors/:instructorId" element={<InstructorProfilePage />} />

        {/* Instructor */}
        <Route
          path="/instructor/dashboard"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <InstructorDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <InstructorCoursesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses/create"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <CourseFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses/:courseId/edit"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <CourseFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses/:courseId/builder"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <CourseBuilderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses/:courseId/learners"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <CourseLearnersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/courses/:courseId/analytics"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <CourseAnalyticsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/instructor/profile"
          element={
            <ProtectedRoute allow={['INSTRUCTOR', 'ADMIN']}>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* Admin */}
        <Route path="/admin/dashboard" element={<ProtectedRoute allow={['ADMIN']}><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute allow={['ADMIN']}><AdminUsersPage /></ProtectedRoute>} />
        <Route path="/admin/courses" element={<ProtectedRoute allow={['ADMIN']}><AdminCoursesPage /></ProtectedRoute>} />
        <Route path="/admin/instructors" element={<ProtectedRoute allow={['ADMIN']}><AdminInstructorsPage /></ProtectedRoute>} />
        <Route path="/admin/reward-pool" element={<ProtectedRoute allow={['ADMIN']}><AdminRewardPoolPage /></ProtectedRoute>} />
        <Route path="/admin/badges" element={<ProtectedRoute allow={['ADMIN']}><AdminBadgesPage /></ProtectedRoute>} />
        <Route path="/admin/analytics" element={<ProtectedRoute allow={['ADMIN']}><AdminAnalyticsPage /></ProtectedRoute>} />
      </Route>

      {/* Landing + catch-all */}
      <Route path="/" element={<RoleHome />} />
      <Route path="*" element={<RouteErrorPage />} />
    </Routes>
  );
}
