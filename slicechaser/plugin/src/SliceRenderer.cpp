#include "SliceRenderer.h"
using namespace ffglex;

namespace sc
{
static const char kVertexShader[] = R"(#version 410 core
layout( location = 0 ) in vec2 vPos;   // composition position, 0..1, y down
layout( location = 1 ) in vec2 vLocal; // position inside the slice frame, 0..1, y down

out vec2 compUV;
out vec2 localUV;

void main()
{
	gl_Position = vec4( vPos.x * 2.0 - 1.0, 1.0 - vPos.y * 2.0, 0.0, 1.0 );
	compUV      = vec2( vPos.x, 1.0 - vPos.y );
	localUV     = vLocal;
}
)";

static const char kFragmentShader[] = R"(#version 410 core
uniform sampler2D InputTexture;
uniform vec2 MaxUV;
uniform int Mode;            // 0 fill, 1 mask, 2 stretch
uniform float Opacity;
uniform float ContentAspect; // input width / height
uniform float SliceAspect;   // slice width / height

in vec2 compUV;
in vec2 localUV;
out vec4 fragColor;

void main()
{
	vec2 uv;
	if( Mode == 1 )
	{
		uv = compUV;
	}
	else
	{
		vec2 l = localUV;
		if( Mode == 0 )
		{
			// cover: keep the content's aspect, crop whatever sticks out
			if( SliceAspect > ContentAspect )
				l.y = 0.5 + ( l.y - 0.5 ) * ( ContentAspect / SliceAspect );
			else
				l.x = 0.5 + ( l.x - 0.5 ) * ( SliceAspect / ContentAspect );
		}
		uv = vec2( l.x, 1.0 - l.y );
	}
	// Resolume works in premultiplied alpha, so fading means scaling all four channels.
	fragColor = texture( InputTexture, uv * MaxUV ) * Opacity;
}
)";

bool SliceRenderer::InitGL()
{
	if( !shader.Compile( kVertexShader, kFragmentShader ) )
		return false;
	glGenVertexArrays( 1, &vao );
	glGenBuffers( 1, &vbo );
	uploaded = ~0ull;
	return vao != 0 && vbo != 0;
}

void SliceRenderer::DeInitGL()
{
	shader.FreeGLResources();
	if( vbo )
		glDeleteBuffers( 1, &vbo );
	if( vao )
		glDeleteVertexArrays( 1, &vao );
	vbo = vao = 0;
	ranges.clear();
	uploaded = ~0ull;
}

void SliceRenderer::Sync( const ChaseFile& file, uint64_t revision )
{
	if( revision == uploaded || vbo == 0 )
		return;
	uploaded = revision;

	std::vector< float > all;
	ranges.clear();
	for( const Slice& s : file.slices )
	{
		Range r;
		r.first  = (GLint)( all.size() / 4 );
		r.count  = (GLsizei)( s.verts.size() / 4 );
		r.aspect = s.aspect;
		all.insert( all.end(), s.verts.begin(), s.verts.end() );
		ranges.push_back( r );
	}

	ScopedVAOBinding vaoBinding( vao );
	ScopedVBOBinding vboBinding( vbo );
	glBufferData( GL_ARRAY_BUFFER, (GLsizeiptr)( all.size() * sizeof( float ) ), all.empty() ? nullptr : all.data(),
	              GL_STATIC_DRAW );
	glEnableVertexAttribArray( 0 );
	glVertexAttribPointer( 0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof( float ), (const void*)0 );
	glEnableVertexAttribArray( 1 );
	glVertexAttribPointer( 1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof( float ), (const void*)( 2 * sizeof( float ) ) );
}

void SliceRenderer::Draw( const FFGLTextureStruct& input, const std::vector< float >& opacities, Scaling scaling )
{
	glClearColor( 0.0f, 0.0f, 0.0f, 0.0f );
	glClear( GL_COLOR_BUFFER_BIT );
	if( ranges.empty() || input.Handle == 0 || input.Height == 0 )
		return;

	ScopedShaderBinding shaderBinding( shader.GetGLID() );
	ScopedSamplerActivation activateSampler( 0 );
	Scoped2DTextureBinding textureBinding( input.Handle );
	ScopedVAOBinding vaoBinding( vao );

	FFGLTexCoords maxCoords = GetMaxGLTexCoords( input );
	shader.Set( "InputTexture", 0 );
	shader.Set( "MaxUV", maxCoords.s, maxCoords.t );
	shader.Set( "Mode", (int)scaling );
	shader.Set( "ContentAspect", (float)input.Width / (float)input.Height );

	glEnable( GL_BLEND );
	if( scaling == Scaling::Mask )
	{
		// Overlapping slices show the same pixels; take the brightest instead of stacking.
		glBlendEquation( GL_MAX );
		glBlendFunc( GL_ONE, GL_ONE );
	}
	else
	{
		glBlendEquation( GL_FUNC_ADD );
		glBlendFunc( GL_ONE, GL_ONE_MINUS_SRC_ALPHA );// premultiplied "over"
	}

	const size_t n = std::min( ranges.size(), opacities.size() );
	for( size_t i = 0; i < n; ++i )
	{
		float o = opacities[ i ];
		if( o <= 0.002f || ranges[ i ].count == 0 )
			continue;
		shader.Set( "Opacity", o > 1.0f ? 1.0f : o );
		shader.Set( "SliceAspect", ranges[ i ].aspect );
		glDrawArrays( GL_TRIANGLES, ranges[ i ].first, ranges[ i ].count );
	}

	// FFGL expects the context back in its default state
	glBlendEquation( GL_FUNC_ADD );
	glBlendFunc( GL_ONE, GL_ZERO );
	glDisable( GL_BLEND );
}

}//namespace sc
