import React from 'react';
import PerformanceOverview from '../components/hr/PerformanceCycles';
import { Helmet } from 'react-helmet';

const Performance = () => {
  return (
    <>
      <Helmet>
        <title>Performance Management | E3 HR System</title>
      </Helmet>
      <PerformanceOverview />
    </>
  );
};

export default Performance;
