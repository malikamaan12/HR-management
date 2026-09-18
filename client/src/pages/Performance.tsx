import {GoalProgress} from '@/components/lifecycle/Goals';
import {Cycles} from '@/components/lifecycle/Cycles';
import React from 'react';
import PerformanceOverview from '../components/performance/PerformanceOverview';
import { Helmet } from 'react-helmet';

const Performance = () => {
  return (
    <>
      <Helmet>
        <title>Performance Management | E3 HR System</title>
      </Helmet>
      <Cycles /><GoalProgress /><PerformanceOverview />
    </>
  );
};

export default Performance;