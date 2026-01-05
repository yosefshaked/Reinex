import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Pencil, FileText } from 'lucide-react';

export default function InstructorMenu({ onNavigate }) {
  const menuItems = [
    {
      id: 'directory',
      title: 'ניהול מצבת כוח אדם',
      description: 'ניהול תפקידים וסטטוסים של עובדים',
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      id: 'profiles',
      title: 'עריכת פרטים אישיים',
      description: 'עדכון שם, טלפון והערות של עובדים',
      icon: Pencil,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      id: 'documents',
      title: 'מרכז מסמכים',
      description: 'ניהול מסמכי ציות ואישורים',
      icon: FileText,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <p className="text-sm text-muted-foreground text-right">בחר את הפעולה הרצויה לניהול עובדי הארגון</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {menuItems.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.id}
            className="cursor-pointer transition-all hover:shadow-lg hover:scale-105 active:scale-100"
            onClick={() => onNavigate(item.id)}
          >
            <CardContent className="p-6 text-center space-y-4">
              <div className={`mx-auto w-16 h-16 rounded-full ${item.bgColor} flex items-center justify-center`}>
                <Icon className={`h-8 w-8 ${item.color}`} />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-base sm:text-lg">{item.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
