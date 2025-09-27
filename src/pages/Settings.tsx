import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ColorPickerDialog } from '@/components/common/ColorPickerDialog';
import {
  User,
  Bell,
  Shield,
  Palette,
  Globe,
  Database,
  Key,
  Monitor,
  Sun,
  Moon,
  Check,
  Type,
  Search,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';

const settingsSections = [
  {
    group: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: User, description: 'Personal information' },
      { id: 'security', label: 'Security', icon: Shield, description: 'Password & authentication' },
      { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Alerts & updates' },
    ],
  },
  {
    group: 'Customization',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme & colors' },
      { id: 'typography', label: 'Typography', icon: Type, description: 'Fonts & text styling' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'language', label: 'Language', icon: Globe, description: 'Region & locale' },
      { id: 'data', label: 'Storage', icon: Database, description: 'Data management' },
    ],
  },
];

export function Settings() {
  const [activeSection, setActiveSection] = useState('profile');
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    customAccentColor,
    setCustomAccentColor,
    customPrimaryColor,
    setCustomPrimaryColor,
    customBackgroundColor,
    setCustomBackgroundColor,
    customForegroundColor,
    setCustomForegroundColor,
    customHeaderColor,
    setCustomHeaderColor,
    customSidebarColor,
    setCustomSidebarColor,
    customBorderColor,
    setCustomBorderColor,
    customSecondaryFontColor,
    setCustomSecondaryFontColor,
    useCustomColors,
    setUseCustomColors,
    density,
    setDensity,
    animations,
    setAnimations,
    blur,
    setBlur,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    fontWeight,
    setFontWeight,
    fontStyle,
    setFontStyle,
    letterSpacing,
    setLetterSpacing,
    lineHeight,
    setLineHeight,
  } = useTheme();

  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [tempColor, setTempColor] = useState('#000000');

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3 },
    },
  };

  return (
    <motion.div
      className="p-6 max-w-7xl mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="flex gap-8">
        <motion.aside className="w-64 shrink-0" variants={itemVariants}>
          <div className="sticky top-6">
            {/* Search */}
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search settings..."
                className="w-full pl-10 pr-3 py-2 text-sm rounded-lg border border-border bg-background hover:border-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
              />
            </div>

            {/* Navigation */}
            <nav className="space-y-6">
              {settingsSections.map((group, groupIndex) => (
                <div key={group.group}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {group.group}
                  </h3>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={cn(
                            'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all group',
                            activeSection === item.id
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted text-foreground'
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-4 h-4 mt-0.5 transition-colors',
                              activeSection === item.id
                                ? 'text-primary'
                                : 'text-muted-foreground group-hover:text-foreground'
                            )}
                          />
                          <div className="text-left">
                            <div className="text-sm font-medium">{item.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {groupIndex < settingsSections.length - 1 && (
                    <div className="mt-4 border-b border-border" />
                  )}
                </div>
              ))}
            </nav>
          </div>
        </motion.aside>

        <motion.main className="flex-1 max-w-4xl" variants={itemVariants}>
          {activeSection === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Profile</h2>
                <p className="text-muted-foreground mt-1">
                  Manage your personal information and account details
                </p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input label="First Name" defaultValue="John" />
                  <Input label="Last Name" defaultValue="Doe" />
                </div>
                <Input label="Email" type="email" defaultValue="john.doe@example.com" />
                <Input label="Username" defaultValue="johndoe" />
                <Input
                  label="Bio"
                  defaultValue="Software developer passionate about creating amazing experiences"
                  helperText="Brief description for your profile"
                />
                <div className="flex justify-end">
                  <Button>Save Changes</Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Notifications</h2>
                <p className="text-muted-foreground mt-1">
                  Control how and when you receive notifications
                </p>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Email notifications', description: 'Receive updates via email' },
                  {
                    label: 'Push notifications',
                    description: 'Get push notifications on your device',
                  },
                  { label: 'Project updates', description: 'Notifications about project activity' },
                  { label: 'Team mentions', description: 'When someone mentions you' },
                  { label: 'Weekly digest', description: 'Summary of weekly activity' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <button
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors',
                        'bg-muted hover:bg-muted/80'
                      )}
                    >
                      <span className="absolute left-0.5 top-0.5 w-5 h-5 bg-background rounded-full transition-transform" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Security</h2>
                <p className="text-muted-foreground mt-1">
                  Protect your account with enhanced security settings
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-4">
                  <Input label="Current Password" type="password" />
                  <Input label="New Password" type="password" />
                  <Input label="Confirm New Password" type="password" />
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="font-medium mb-3">Two-Factor Authentication</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Add an extra layer of security to your account
                  </p>
                  <Button variant="outline" icon={<Key className="w-4 h-4" />}>
                    Enable 2FA
                  </Button>
                </div>

                <div className="flex justify-end">
                  <Button>Update Security</Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold">Appearance</h2>
                <p className="text-muted-foreground mt-1">
                  Customize the visual appearance of the application
                </p>
              </div>

              {/* Theme & Density */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-4">Theme & Display</h3>
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1">
                      <label className="text-sm text-muted-foreground mb-3 block">Theme Mode</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            value: 'light' as const,
                            label: 'Light',
                            icon: Sun,
                            gradient: 'from-amber-200 to-yellow-400',
                          },
                          {
                            value: 'dark' as const,
                            label: 'Dark',
                            icon: Moon,
                            gradient: 'from-slate-800 to-slate-900',
                          },
                          {
                            value: 'system' as const,
                            label: 'System',
                            icon: Monitor,
                            gradient: 'from-blue-400 to-indigo-600',
                          },
                        ].map((option) => {
                          const Icon = option.icon;
                          return (
                            <motion.button
                              key={option.value}
                              onClick={() => setTheme(option.value)}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              className={cn(
                                'relative p-3 rounded-lg border-2 transition-all overflow-hidden group',
                                theme === option.value
                                  ? 'border-primary shadow-lg'
                                  : 'border-border hover:border-muted-foreground'
                              )}
                            >
                              <div
                                className={cn(
                                  'absolute inset-0 bg-gradient-to-br opacity-10 group-hover:opacity-20 transition-opacity',
                                  option.gradient
                                )}
                              />
                              <div className="relative">
                                <Icon className="w-5 h-5 mb-1 mx-auto" />
                                <p className="text-xs font-medium">{option.label}</p>
                              </div>
                              {theme === option.value && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                                >
                                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                                </motion.div>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="text-sm text-muted-foreground mb-3 block">
                        Interface Density
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: 'comfortable' as const, label: 'Comfortable' },
                          { value: 'compact' as const, label: 'Compact' },
                          { value: 'minimal' as const, label: 'Minimal' },
                        ].map((option) => (
                          <motion.button
                            key={option.value}
                            onClick={() => setDensity(option.value)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={cn(
                              'relative p-3 rounded-lg border-2 transition-all overflow-hidden',
                              density === option.value
                                ? 'border-primary shadow-lg bg-primary/10'
                                : 'border-border hover:border-muted-foreground hover:bg-muted'
                            )}
                          >
                            <p className="text-xs font-medium">{option.label}</p>
                            {density === option.value && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                              >
                                <Check className="w-2.5 h-2.5 text-primary-foreground" />
                              </motion.div>
                            )}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-4">Accent Color</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      {
                        name: 'blue' as const,
                        color: 'bg-blue-500',
                        gradient: 'from-blue-400 to-blue-600',
                      },
                      {
                        name: 'purple' as const,
                        color: 'bg-purple-500',
                        gradient: 'from-purple-400 to-purple-600',
                      },
                      {
                        name: 'green' as const,
                        color: 'bg-green-500',
                        gradient: 'from-green-400 to-green-600',
                      },
                      {
                        name: 'orange' as const,
                        color: 'bg-orange-500',
                        gradient: 'from-orange-400 to-orange-600',
                      },
                      {
                        name: 'pink' as const,
                        color: 'bg-pink-500',
                        gradient: 'from-pink-400 to-pink-600',
                      },
                      {
                        name: 'cyan' as const,
                        color: 'bg-cyan-500',
                        gradient: 'from-cyan-400 to-cyan-600',
                      },
                      {
                        name: 'indigo' as const,
                        color: 'bg-indigo-500',
                        gradient: 'from-indigo-400 to-indigo-600',
                      },
                      {
                        name: 'custom' as const,
                        color: '',
                        gradient:
                          'from-red-400 via-yellow-400 via-green-400 via-blue-400 via-indigo-400 via-purple-400 to-pink-400',
                      },
                    ].map((color) => (
                      <motion.button
                        key={color.name}
                        onClick={() => {
                          if (color.name === 'custom') {
                            setAccentColor('custom');
                            setTempColor(customAccentColor);
                            setActiveColorPicker('accent');
                          } else {
                            setAccentColor(color.name);
                          }
                        }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className={cn(
                          'relative w-12 h-12 rounded-xl overflow-hidden transition-all',
                          'ring-2 ring-offset-2 ring-offset-background',
                          accentColor === color.name
                            ? 'ring-primary shadow-lg'
                            : 'ring-transparent hover:ring-muted-foreground/50'
                        )}
                        aria-label={`${color.name} accent`}
                      >
                        {color.name === 'custom' ? (
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                accentColor === 'custom'
                                  ? customAccentColor
                                  : `conic-gradient(from 180deg at 50% 50%, #ef4444, #f59e0b, #eab308, #84cc16, #22c55e, #14b8a6, #06b6d4, #3b82f6, #6366f1, #8b5cf6, #a855f7, #d946ef, #ec4899, #ef4444)`,
                            }}
                          />
                        ) : (
                          <div
                            className={cn('absolute inset-0 bg-gradient-to-br', color.gradient)}
                          />
                        )}
                        {accentColor === color.name && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                          >
                            <Check className="w-4 h-4 text-white drop-shadow-md" />
                          </motion.div>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-4">Visual Effects</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <span className="text-sm font-medium">Glass morphism effects</span>
                        <p className="text-xs text-muted-foreground">
                          Blur and transparency effects
                        </p>
                      </div>
                      <button
                        onClick={() => setBlur(!blur)}
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                          blur ? 'bg-primary' : 'bg-muted hover:bg-muted/80'
                        )}
                      >
                        <motion.span
                          className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-sm"
                          animate={{ left: blur ? '1.25rem' : '0.125rem' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <span className="text-sm font-medium">Smooth animations</span>
                        <p className="text-xs text-muted-foreground">
                          Transitions and micro-interactions
                        </p>
                      </div>
                      <button
                        onClick={() => setAnimations(!animations)}
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                          animations ? 'bg-primary' : 'bg-muted hover:bg-muted/80'
                        )}
                      >
                        <motion.span
                          className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-sm"
                          animate={{ left: animations ? '1.25rem' : '0.125rem' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    <div className="pt-2 text-xs text-muted-foreground">
                      <p>
                        Note: Disabling visual effects can improve performance on slower systems.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <h3 className="font-medium flex-1">Custom Theme Colors</h3>
                    <button
                      onClick={() => setUseCustomColors(!useCustomColors)}
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                        useCustomColors ? 'bg-primary' : 'bg-muted hover:bg-muted/80'
                      )}
                    >
                      <motion.span
                        className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-sm"
                        animate={{ left: useCustomColors ? '1.25rem' : '0.125rem' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {useCustomColors && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Primary</label>
                        <button
                          onClick={() => {
                            setTempColor(customPrimaryColor);
                            setActiveColorPicker('primary');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customPrimaryColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Background
                        </label>
                        <button
                          onClick={() => {
                            setTempColor(customBackgroundColor);
                            setActiveColorPicker('background');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customBackgroundColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Main Text
                        </label>
                        <button
                          onClick={() => {
                            setTempColor(customForegroundColor);
                            setActiveColorPicker('foreground');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customForegroundColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Header</label>
                        <button
                          onClick={() => {
                            setTempColor(customHeaderColor);
                            setActiveColorPicker('header');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customHeaderColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Sidebar</label>
                        <button
                          onClick={() => {
                            setTempColor(customSidebarColor);
                            setActiveColorPicker('sidebar');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customSidebarColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Borders</label>
                        <button
                          onClick={() => {
                            setTempColor(customBorderColor);
                            setActiveColorPicker('border');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customBorderColor }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Secondary Text (Descriptions)
                        </label>
                        <button
                          onClick={() => {
                            setTempColor(customSecondaryFontColor);
                            setActiveColorPicker('secondaryFont');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: customSecondaryFontColor }}
                          />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'typography' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold">Typography</h2>
                <p className="text-muted-foreground mt-1">
                  Customize fonts and text styling throughout the application
                </p>
              </div>

              {/* Live Preview */}
              <div className="p-6 rounded-lg border border-border bg-muted/30">
                <div className="space-y-3">
                  <h3
                    className="text-lg font-semibold"
                    style={{
                      fontSize: `${fontSize * 1.2}px`,
                      fontFamily: fontFamily,
                      fontWeight: fontWeight,
                      fontStyle: fontStyle,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    Preview: Main Heading
                  </h3>
                  <p
                    style={{
                      fontSize: `${fontSize}px`,
                      fontFamily: fontFamily,
                      fontWeight: fontWeight,
                      fontStyle: fontStyle,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    This is a preview of your typography settings. The quick brown fox jumps over
                    the lazy dog. Adjust the settings below to see how your text will appear
                    throughout the application.
                  </p>
                  <p
                    className="text-muted-foreground"
                    style={{
                      fontSize: `${fontSize * 0.875}px`,
                      fontFamily: fontFamily,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    Secondary text appears like this, used for descriptions and supporting content.
                  </p>
                </div>
              </div>

              {/* Presets */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Quick Presets
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => {
                      setFontSize(16);
                      setFontFamily("'Inter', sans-serif");
                      setFontWeight('400');
                      setLetterSpacing(0.02);
                      setLineHeight(1.7);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Reading
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(14);
                      setFontFamily('system-ui');
                      setFontWeight('400');
                      setLetterSpacing(0);
                      setLineHeight(1.4);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Compact
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(18);
                      setFontFamily("'Poppins', sans-serif");
                      setFontWeight('500');
                      setLetterSpacing(0.01);
                      setLineHeight(1.6);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Presentation
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(15);
                      setFontFamily('system-ui');
                      setFontWeight('400');
                      setFontStyle('normal');
                      setLetterSpacing(0);
                      setLineHeight(1.5);
                    }}
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Default
                  </button>
                </div>
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-6">
                {/* Font Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium">Font</h3>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Family</label>
                    <select
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                    >
                      <option value="system-ui">System Default</option>
                      <option value="'Inter', sans-serif">Inter</option>
                      <option value="'Roboto', sans-serif">Roboto</option>
                      <option value="'Open Sans', sans-serif">Open Sans</option>
                      <option value="'Lato', sans-serif">Lato</option>
                      <option value="'Poppins', sans-serif">Poppins</option>
                      <option value="'SF Pro Display', sans-serif">SF Pro</option>
                      <option value="'Segoe UI', sans-serif">Segoe UI</option>
                      <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                      <option value="'Fira Code', monospace">Fira Code</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Size</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="12"
                        max="20"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono w-12 text-center bg-muted rounded px-2 py-1">
                        {fontSize}px
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Weight</label>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { value: '300', label: 'Light' },
                        { value: '400', label: 'Regular' },
                        { value: '500', label: 'Medium' },
                        { value: '600', label: 'Semibold' },
                        { value: '700', label: 'Bold' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setFontWeight(option.value)}
                          className={cn(
                            'px-2 py-1.5 text-sm rounded transition-colors',
                            fontWeight === option.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Style</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setFontStyle('normal')}
                        className={cn(
                          'px-3 py-2 rounded-lg border transition-all text-sm',
                          fontStyle === 'normal'
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        Normal
                      </button>
                      <button
                        onClick={() => setFontStyle('italic')}
                        className={cn(
                          'px-3 py-2 rounded-lg border transition-all text-sm italic',
                          fontStyle === 'italic'
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        Italic
                      </button>
                    </div>
                  </div>
                </div>

                {/* Spacing Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium">Spacing</h3>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">
                      Letter Spacing
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Tight</span>
                      <input
                        type="range"
                        min="-0.05"
                        max="0.1"
                        step="0.01"
                        value={letterSpacing}
                        onChange={(e) => setLetterSpacing(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground">Wide</span>
                      <span className="text-sm font-mono w-16 text-center bg-muted rounded px-2 py-1">
                        {letterSpacing.toFixed(2)}em
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Line Height</label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Compact</span>
                      <input
                        type="range"
                        min="1"
                        max="2"
                        step="0.1"
                        value={lineHeight}
                        onChange={(e) => setLineHeight(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground">Spacious</span>
                      <span className="text-sm font-mono w-12 text-center bg-muted rounded px-2 py-1">
                        {lineHeight.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'language' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Language & Region</h2>
                <p className="text-muted-foreground mt-1">
                  Set your language, timezone, and regional preferences
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Language</label>
                  <select className="w-full px-3 py-2 rounded-md border border-input bg-background">
                    <option>English (US)</option>
                    <option>Spanish</option>
                    <option>French</option>
                    <option>German</option>
                    <option>Japanese</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Timezone</label>
                  <select className="w-full px-3 py-2 rounded-md border border-input bg-background">
                    <option>UTC-08:00 Pacific Time</option>
                    <option>UTC-05:00 Eastern Time</option>
                    <option>UTC+00:00 GMT</option>
                    <option>UTC+01:00 Central European Time</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Date Format</label>
                  <select className="w-full px-3 py-2 rounded-md border border-input bg-background">
                    <option>MM/DD/YYYY</option>
                    <option>DD/MM/YYYY</option>
                    <option>YYYY-MM-DD</option>
                  </select>
                </div>

                <div className="flex justify-end">
                  <Button>Save Preferences</Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'data' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Storage</h2>
                <p className="text-muted-foreground mt-1">
                  Manage your data storage and application cache
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">Storage Used</p>
                      <p className="text-sm text-muted-foreground">2.4 GB of 10 GB</p>
                    </div>
                    <span className="text-2xl font-bold">24%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="w-1/4 h-full bg-primary" />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-border">
                  <Button variant="outline" className="w-full">
                    Clear Cache
                  </Button>
                  <Button variant="outline" className="w-full">
                    Export Data
                  </Button>
                  <Button variant="destructive" className="w-full">
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.main>
      </div>

      <ColorPickerDialog
        isOpen={activeColorPicker !== null}
        onClose={() => setActiveColorPicker(null)}
        color={tempColor}
        onColorChange={(color) => {
          switch (activeColorPicker) {
            case 'accent':
              setCustomAccentColor(color);
              setAccentColor('custom');
              break;
            case 'primary':
              setCustomPrimaryColor(color);
              break;
            case 'background':
              setCustomBackgroundColor(color);
              break;
            case 'foreground':
              setCustomForegroundColor(color);
              break;
            case 'header':
              setCustomHeaderColor(color);
              break;
            case 'sidebar':
              setCustomSidebarColor(color);
              break;
            case 'border':
              setCustomBorderColor(color);
              break;
            case 'secondaryFont':
              setCustomSecondaryFontColor(color);
              break;
          }
          setActiveColorPicker(null);
        }}
        title={
          activeColorPicker === 'accent'
            ? 'Custom Accent Color'
            : activeColorPicker === 'primary'
              ? 'Custom Primary Color'
              : activeColorPicker === 'background'
                ? 'Custom Background Color'
                : activeColorPicker === 'foreground'
                  ? 'Custom Text Color'
                  : activeColorPicker === 'header'
                    ? 'Custom Header Color'
                    : activeColorPicker === 'sidebar'
                      ? 'Custom Sidebar Color'
                      : activeColorPicker === 'border'
                        ? 'Custom Border Color'
                        : activeColorPicker === 'secondaryFont'
                          ? 'Secondary Text Color'
                          : 'Pick a Color'
        }
      />
    </motion.div>
  );
}
