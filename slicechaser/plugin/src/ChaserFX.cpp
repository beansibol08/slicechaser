// SliceChaser: plays a sequence by animating the Step parameter (BPM Sync, Timeline, FFT...).
#include "ChaseEffect.h"
#include <cmath>

namespace sc
{
class ChaserFX : public ChaseEffect
{
public:
	enum : unsigned int
	{
		PID_STEP = PID_FIRST_CUSTOM,
		PID_ECHOES,
		PID_SUSTAIN,
		PID_RELEASE,
		PID_REVERSE
	};

	ChaserFX()
	{
		SetParamInfof( PID_STEP, "Step", FF_TYPE_STANDARD );
		SetParamInfo( PID_ECHOES, "Echoes", FF_TYPE_INTEGER, (float)echoes );
		SetParamRange( PID_ECHOES, 1.0f, 16.0f );
		SetParamInfo( PID_SUSTAIN, "Sustain", FF_TYPE_STANDARD, sustain );
		SetParamInfo( PID_RELEASE, "Release", FF_TYPE_STANDARD, release );
		SetParamInfo( PID_REVERSE, "Reverse", FF_TYPE_BOOLEAN, false );
		FFGLLog::LogToHost( ( "SliceChaser reading " + ChaseFilePath() ).c_str() );
	}

protected:
	void ComputeOpacities( const ChaseFile& file, const Sequence* seq, std::vector< float >& out ) override
	{
		if( !seq )
		{
			out.assign( file.slices.size(), 0.0f );
			return;
		}
		ChaserOpacities( *seq, file.slices.size(), step, (int)std::lround( echoes ), sustain, release, reverse, out );
	}

	FFResult SetCustomFloat( unsigned int index, float value ) override
	{
		switch( index )
		{
		case PID_STEP: step = value; break;
		case PID_ECHOES: echoes = value; break;
		case PID_SUSTAIN: sustain = value; break;
		case PID_RELEASE: release = value; break;
		case PID_REVERSE: reverse = value > 0.5f; break;
		default: return FF_FAIL;
		}
		return FF_SUCCESS;
	}

	float GetCustomFloat( unsigned int index ) override
	{
		switch( index )
		{
		case PID_STEP: return step;
		case PID_ECHOES: return echoes;
		case PID_SUSTAIN: return sustain;
		case PID_RELEASE: return release;
		case PID_REVERSE: return reverse ? 1.0f : 0.0f;
		default: return 0.0f;
		}
	}

private:
	float step    = 0.0f;
	float echoes  = 1.0f;
	float sustain = 0.2f;
	float release = 0.8f;
	bool reverse  = false;
};

}//namespace sc

static CFFGLPluginInfo PluginInfo(
	PluginFactory< sc::ChaserFX >,
	"SCch",                                       // unique 4-char id
	"SliceChaser",                                // name shown in Resolume
	2,                                            // API major
	1,                                            // API minor
	1,                                            // plugin major
	0,                                            // plugin minor
	FF_EFFECT,
	"Chases Advanced Output slices step by step", // description
	"SliceChaser" );
